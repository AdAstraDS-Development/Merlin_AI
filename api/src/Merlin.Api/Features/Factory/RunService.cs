using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Merlin.Api.Data;
using Microsoft.Extensions.Options;

namespace Merlin.Api.Features.Factory;

public sealed class RunConflictException(string slug) : Exception($"A run for {slug} is already in progress.");

/// <summary>A run in progress: its events so far and a signal for readers waiting for the next one.</summary>
public sealed class LiveRun(string id)
{
    private readonly Lock _gate = new();
    private readonly List<string> _events = [];
    private TaskCompletionSource _changed = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public string Id { get; } = id;
    public bool Finished { get; private set; }

    public int Count { get { lock (_gate) return _events.Count; } }

    public void Add(string json) => Signal(() => _events.Add(json));
    public void Finish() => Signal(() => Finished = true);

    /// <summary>Events from <paramref name="from"/>, whether the run has finished, and a task that completes on the next change.</summary>
    public (string[] Events, bool Finished, Task Changed) Read(int from)
    {
        lock (_gate) return ([.. _events.Skip(from)], Finished, _changed.Task);
    }

    private void Signal(Action change)
    {
        TaskCompletionSource previous;
        lock (_gate)
        {
            change();
            previous = _changed;
            _changed = new(TaskCreationOptions.RunContinuationsAsynchronously);
        }
        previous.TrySetResult();
    }
}

/// <summary>
/// Starts dry runs and Factory runs (one per app at a time), runs them in the background, stores every event in the registry and
/// lets readers follow runs in progress. Single instance only: runs that were running when the app stopped are failed at startup.
/// </summary>
public sealed class RunService(IAppRegistry registry, IOptions<FactoryOptions> options, IGitHub github, TimeProvider time, ILogger<RunService> logger) : IHostedService
{
    private const int MaxEventLength = 4000;
    private readonly ConcurrentDictionary<string, LiveRun> _live = new();
    private readonly ConcurrentDictionary<string, Task> _tasks = new();
    private readonly HashSet<string> _runningSlugs = [];
    private readonly Lock _gate = new();
    private readonly CancellationTokenSource _stopping = new();

    public async Task StartAsync(CancellationToken cancellationToken) => await FailInterruptedAsync(cancellationToken);

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        await _stopping.CancelAsync();
        await Task.WhenAll(_tasks.Values).WaitAsync(cancellationToken).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
    }

    public LiveRun? Live(string runId) => _live.GetValueOrDefault(runId);

    /// <summary>Stores the run and its app and starts it. Throws <see cref="RunConflictException"/> when the app has a run in progress.</summary>
    public Task<string> StartDryRunAsync(JsonObject request, string userOid, string userName, CancellationToken ct) =>
        StartRunAsync("DryRun", request, userOid, userName, ct);

    /// <summary>
    /// Stores the run and its app and starts it: <c>DryRun</c> creates nothing; <c>Factory</c> creates the repository (UC-08) and sets the
    /// app to <c>provisioning</c>, then <c>requested</c> or <c>failed</c>. Throws <see cref="RunConflictException"/> when the app has a run in progress.
    /// </summary>
    public async Task<string> StartRunAsync(string mode, JsonObject request, string userOid, string userName, CancellationToken ct)
    {
        var slug = request["appSlug"]!.GetValue<string>();
        lock (_gate)
            if (!_runningSlugs.Add(slug)) throw new RunConflictException(slug);
        var now = time.GetUtcNow();
        var id = $"{now:yyyyMMdd-HHmmss}-{Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(3))}";
        var name = request["appName"]!.GetValue<string>();
        try
        {
            await registry.StartRunAsync(
                new RunEntity { Id = id, AppSlug = slug, AppName = name, Mode = mode, Status = "running", StartedAt = now, StartedByOid = userOid },
                new AppEntity { Slug = slug, Name = name, Status = mode == "Factory" ? "provisioning" : "simulated", CreatedAt = now, UpdatedAt = now, RequestedByOid = userOid, RequestedByName = userName, RequestJson = request.ToJsonString() },
                ct);
        }
        catch
        {
            lock (_gate) _runningSlugs.Remove(slug);
            throw;
        }
        var live = new LiveRun(id);
        _live[id] = live;
        _tasks[id] = Task.Run(() => PlayAsync(live, mode, slug, request), CancellationToken.None);
        logger.LogInformation("{Mode} run {RunId} started for {Slug}", mode, id, slug);
        return id;
    }

    private async Task PlayAsync(LiveRun live, string mode, string slug, JsonObject request)
    {
        var factory = mode == "Factory";
        var status = "failed";
        string? message = null;
        try
        {
            if (factory) await FactoryRun.RunAsync(live.Id, request, options.Value, github, e => EmitAsync(live, e), _stopping.Token);
            else await DryRun.RunAsync(live.Id, request, options.Value, e => EmitAsync(live, e), _stopping.Token);
            status = "succeeded";
            message = factory ? FactoryRun.Finished : "Dry run finished. Nothing was created.";
        }
        catch (Exception ex)
        {
            message = ex switch
            {
                OperationCanceledException => "Merlin stopped during the run.",
                RunStepFailedException => ex.Message,
                _ => factory ? "The Factory run failed." : "The dry run failed.",
            };
            if (ex is RunStepFailedException) logger.LogWarning("{Mode} run {RunId} failed: {Message}", mode, live.Id, ex.Message);
            else if (ex is not OperationCanceledException) logger.LogError(ex, "{Mode} run {RunId} failed", mode, live.Id);
            try { await EmitAsync(live, new JsonObject { ["type"] = "result", ["status"] = "failed", ["message"] = message }); }
            catch (Exception emitError) { logger.LogError(emitError, "Could not store the result of run {RunId}", live.Id); }
        }
        finally
        {
            var stored = false;
            // The app's status first, so a reader who sees the run finished also sees the app's final status.
            if (factory)
                try { await registry.SetAppStatusAsync(slug, status == "succeeded" ? "requested" : "failed", time.GetUtcNow(), CancellationToken.None); }
                catch (Exception ex) { logger.LogError(ex, "Could not set the status of {Slug} after run {RunId}", slug, live.Id); }
            try { await registry.FinishRunAsync(live.Id, status, time.GetUtcNow(), message, CancellationToken.None); stored = true; }
            catch (Exception ex) { logger.LogError(ex, "Could not finish run {RunId}", live.Id); }
            lock (_gate) _runningSlugs.Remove(slug);
            live.Finish();
            // While the registry still says running, readers keep the finished live run, so they end instead of polling until the next restart fails it.
            if (stored) _live.TryRemove(live.Id, out _);
            _tasks.TryRemove(live.Id, out _);
        }
    }

    private async Task EmitAsync(LiveRun live, JsonObject e)
    {
        var at = new JsonObject { ["type"] = e["type"]!.DeepClone(), ["at"] = time.GetUtcNow().ToString("o") };
        foreach (var kv in e.Where(kv => kv.Key != "type").ToList()) at[kv.Key] = kv.Value?.DeepClone();
        var json = at.ToJsonString();
        if (json.Length > MaxEventLength && at.Remove("commands")) json = at.ToJsonString();
        await registry.AddEventAsync(live.Id, live.Count, json, CancellationToken.None);
        live.Add(json);
    }

    /// <summary>Fails the runs that were still running when Merlin stopped, with a failed result event.</summary>
    public async Task FailInterruptedAsync(CancellationToken ct)
    {
        foreach (var run in await registry.ListRunningAsync(ct))
        {
            const string message = "Merlin restarted during the run.";
            var seq = (await registry.ListEventsAsync(run.Id, 0, ct)).Count;
            var result = new JsonObject { ["type"] = "result", ["at"] = time.GetUtcNow().ToString("o"), ["status"] = "failed", ["message"] = message };
            await registry.AddEventAsync(run.Id, seq, result.ToJsonString(), ct);
            if (run.Mode == "Factory") await registry.SetAppStatusAsync(run.AppSlug, "failed", time.GetUtcNow(), ct);
            await registry.FinishRunAsync(run.Id, "failed", time.GetUtcNow(), message, ct);
            logger.LogWarning("Run {RunId} was interrupted and is marked failed", run.Id);
        }
    }
}
