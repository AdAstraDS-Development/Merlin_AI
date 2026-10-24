namespace Merlin.Api.Data;

/// <summary>Registry kept in memory, for local development without a database and for tests. Never used in Azure (see <see cref="DataServices"/>).</summary>
public sealed class InMemoryAppRegistry : IAppRegistry
{
    private readonly Lock _gate = new();
    private readonly Dictionary<string, AppEntity> _apps = [];
    private readonly Dictionary<string, RunEntity> _runs = [];
    private readonly Dictionary<string, List<string>> _events = [];
    private readonly List<CheckEntity> _checks = [];

    // Copies keep callers from changing stored rows, as with a database.
    private static AppEntity Copy(AppEntity a) => new()
    {
        Slug = a.Slug,
        Name = a.Name,
        Status = a.Status,
        CreatedAt = a.CreatedAt,
        UpdatedAt = a.UpdatedAt,
        RequestedByOid = a.RequestedByOid,
        RequestedByName = a.RequestedByName,
        RequestJson = a.RequestJson,
    };
    private static RunEntity Copy(RunEntity r) => new()
    {
        Id = r.Id,
        AppSlug = r.AppSlug,
        AppName = r.AppName,
        Mode = r.Mode,
        Status = r.Status,
        StartedAt = r.StartedAt,
        FinishedAt = r.FinishedAt,
        StartedByOid = r.StartedByOid,
        Message = r.Message,
    };

    public Task<IReadOnlyList<AppEntity>> ListAppsAsync(CancellationToken ct = default)
    {
        lock (_gate) return Task.FromResult<IReadOnlyList<AppEntity>>([.. _apps.Values.OrderByDescending(a => a.UpdatedAt).Select(Copy)]);
    }

    public Task<AppEntity?> GetAppAsync(string slug, CancellationToken ct = default)
    {
        lock (_gate) return Task.FromResult(_apps.TryGetValue(slug, out var a) ? Copy(a) : null);
    }

    public Task StartRunAsync(RunEntity run, AppEntity app, CancellationToken ct = default)
    {
        lock (_gate)
        {
            if (!_apps.TryGetValue(app.Slug, out var existing)) _apps[app.Slug] = Copy(app);
            else if (existing.Status == "simulated")
            {
                existing.Name = app.Name;
                existing.RequestJson = app.RequestJson;
                existing.Status = app.Status;
                existing.UpdatedAt = app.UpdatedAt;
            }
            else existing.UpdatedAt = app.UpdatedAt;
            _runs[run.Id] = Copy(run);
            _events[run.Id] = [];
        }
        return Task.CompletedTask;
    }

    public Task SetAppStatusAsync(string slug, string status, DateTimeOffset at, CancellationToken ct = default)
    {
        lock (_gate)
            if (_apps.TryGetValue(slug, out var a)) { a.Status = status; a.UpdatedAt = at; }
        return Task.CompletedTask;
    }

    public Task FinishRunAsync(string runId, string status, DateTimeOffset at, string? message, CancellationToken ct = default)
    {
        lock (_gate)
            if (_runs.TryGetValue(runId, out var r)) { r.Status = status; r.FinishedAt = at; r.Message = message; }
        return Task.CompletedTask;
    }

    public Task<RunEntity?> GetRunAsync(string runId, CancellationToken ct = default)
    {
        lock (_gate) return Task.FromResult(_runs.TryGetValue(runId, out var r) ? Copy(r) : null);
    }

    public Task<IReadOnlyList<RunEntity>> ListRunsAsync(string slug, CancellationToken ct = default)
    {
        lock (_gate) return Task.FromResult<IReadOnlyList<RunEntity>>([.. _runs.Values.Where(r => r.AppSlug == slug).OrderByDescending(r => r.StartedAt).Take(50).Select(Copy)]);
    }

    public Task AddEventAsync(string runId, int seq, string json, CancellationToken ct = default)
    {
        lock (_gate)
        {
            var list = _events[runId];
            if (seq != list.Count) throw new InvalidOperationException($"Event {seq} of run {runId} is out of order.");
            list.Add(json);
        }
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<string>> ListEventsAsync(string runId, int from, CancellationToken ct = default)
    {
        lock (_gate) return Task.FromResult<IReadOnlyList<string>>(_events.TryGetValue(runId, out var list) ? [.. list.Skip(from)] : []);
    }

    public Task AddCheckAsync(CheckEntity check, CancellationToken ct = default)
    {
        lock (_gate) _checks.Add(check);
        return Task.CompletedTask;
    }

    public Task<CheckEntity?> GetLastCheckAsync(string slug, CancellationToken ct = default)
    {
        lock (_gate) return Task.FromResult(_checks.Where(c => c.AppSlug == slug).OrderByDescending(c => c.At).FirstOrDefault());
    }

    public Task<IReadOnlyList<RunEntity>> ListRunningAsync(CancellationToken ct = default)
    {
        lock (_gate) return Task.FromResult<IReadOnlyList<RunEntity>>([.. _runs.Values.Where(r => r.Status == "running").Select(Copy)]);
    }
}
