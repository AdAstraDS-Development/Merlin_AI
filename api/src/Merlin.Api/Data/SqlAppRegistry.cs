using Microsoft.EntityFrameworkCore;

namespace Merlin.Api.Data;

public sealed class SqlAppRegistry(IDbContextFactory<MerlinDbContext> factory) : IAppRegistry
{
    public async Task<IReadOnlyList<AppEntity>> ListAppsAsync(CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        return await db.Apps.AsNoTracking().OrderByDescending(a => a.UpdatedAt).ToListAsync(ct);
    }

    public async Task<AppEntity?> GetAppAsync(string slug, CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        return await db.Apps.AsNoTracking().SingleOrDefaultAsync(a => a.Slug == slug, ct);
    }

    public async Task StartRunAsync(RunEntity run, AppEntity app, CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            var existing = await db.Apps.SingleOrDefaultAsync(a => a.Slug == app.Slug, ct);
            if (existing is null) db.Apps.Add(app);
            else if (existing.Status == "simulated")
            {
                existing.Name = app.Name;
                existing.RequestJson = app.RequestJson;
                existing.Status = app.Status;
                existing.UpdatedAt = app.UpdatedAt;
            }
            else existing.UpdatedAt = app.UpdatedAt;
            db.Runs.Add(run);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        });
    }

    public async Task SetAppStatusAsync(string slug, string status, DateTimeOffset at, CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        await db.Apps.Where(a => a.Slug == slug).ExecuteUpdateAsync(s => s.SetProperty(a => a.Status, status).SetProperty(a => a.UpdatedAt, at), ct);
    }

    public async Task FinishRunAsync(string runId, string status, DateTimeOffset at, string? message, CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        await db.Runs.Where(r => r.Id == runId).ExecuteUpdateAsync(s => s
            .SetProperty(r => r.Status, status).SetProperty(r => r.FinishedAt, at).SetProperty(r => r.Message, message), ct);
    }

    public async Task<RunEntity?> GetRunAsync(string runId, CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        return await db.Runs.AsNoTracking().SingleOrDefaultAsync(r => r.Id == runId, ct);
    }

    public async Task<IReadOnlyList<RunEntity>> ListRunsAsync(string slug, CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        return await db.Runs.AsNoTracking().Where(r => r.AppSlug == slug).OrderByDescending(r => r.StartedAt).Take(50).ToListAsync(ct);
    }

    public async Task AddEventAsync(string runId, int seq, string json, CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        db.RunEvents.Add(new RunEventEntity { RunId = runId, Seq = seq, Json = json });
        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<string>> ListEventsAsync(string runId, int from, CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        return await db.RunEvents.AsNoTracking().Where(e => e.RunId == runId && e.Seq >= from).OrderBy(e => e.Seq).Select(e => e.Json).ToListAsync(ct);
    }

    public async Task AddCheckAsync(CheckEntity check, CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        db.Checks.Add(check);
        await db.SaveChangesAsync(ct);
    }

    public async Task<CheckEntity?> GetLastCheckAsync(string slug, CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        return await db.Checks.AsNoTracking().Where(c => c.AppSlug == slug).OrderByDescending(c => c.At).FirstOrDefaultAsync(ct);
    }

    public async Task<IReadOnlyList<RunEntity>> ListRunningAsync(CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        return await db.Runs.AsNoTracking().Where(r => r.Status == "running").ToListAsync(ct);
    }
}
