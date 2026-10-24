namespace Merlin.Api.Data;

/// <summary>Storage of the factory registry. <see cref="SqlAppRegistry"/> in Azure, <see cref="InMemoryAppRegistry"/> for local development and tests.</summary>
public interface IAppRegistry
{
    Task<IReadOnlyList<AppEntity>> ListAppsAsync(CancellationToken ct = default);
    Task<AppEntity?> GetAppAsync(string slug, CancellationToken ct = default);
    /// <summary>Stores a new run and creates or updates its app. A run never overwrites the request or status of an app that is not simulated.</summary>
    Task StartRunAsync(RunEntity run, AppEntity app, CancellationToken ct = default);
    /// <summary>Sets the status of an app, for example at the end of a Factory run.</summary>
    Task SetAppStatusAsync(string slug, string status, DateTimeOffset at, CancellationToken ct = default);
    Task FinishRunAsync(string runId, string status, DateTimeOffset at, string? message, CancellationToken ct = default);
    Task<RunEntity?> GetRunAsync(string runId, CancellationToken ct = default);
    /// <summary>The runs of an app, newest first.</summary>
    Task<IReadOnlyList<RunEntity>> ListRunsAsync(string slug, CancellationToken ct = default);
    Task AddEventAsync(string runId, int seq, string json, CancellationToken ct = default);
    /// <summary>The stored events of a run from <paramref name="from"/> on, in order.</summary>
    Task<IReadOnlyList<string>> ListEventsAsync(string runId, int from, CancellationToken ct = default);
    Task AddCheckAsync(CheckEntity check, CancellationToken ct = default);
    Task<CheckEntity?> GetLastCheckAsync(string slug, CancellationToken ct = default);
    /// <summary>The runs still marked running, for example after a restart.</summary>
    Task<IReadOnlyList<RunEntity>> ListRunningAsync(CancellationToken ct = default);
}
