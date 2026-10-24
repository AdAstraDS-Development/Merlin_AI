using Microsoft.EntityFrameworkCore;

namespace Merlin.Api.Data;

/// <summary>The factory registry (UC-03, UC-04, UC-05): apps, their runs with the run events, and status checks.</summary>
public sealed class MerlinDbContext(DbContextOptions<MerlinDbContext> options) : DbContext(options)
{
    public DbSet<AppEntity> Apps => Set<AppEntity>();
    public DbSet<RunEntity> Runs => Set<RunEntity>();
    public DbSet<RunEventEntity> RunEvents => Set<RunEventEntity>();
    public DbSet<CheckEntity> Checks => Set<CheckEntity>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.HasDefaultSchema("factory");
        model.Entity<AppEntity>(e =>
        {
            e.ToTable("Apps");
            e.HasKey(x => x.Slug);
            e.Property(x => x.Slug).HasMaxLength(25);
            e.Property(x => x.Name).HasMaxLength(40);
            e.Property(x => x.Status).HasMaxLength(20);
            e.Property(x => x.RequestedByOid).HasMaxLength(64);
            e.Property(x => x.RequestedByName).HasMaxLength(200);
        });
        model.Entity<RunEntity>(e =>
        {
            e.ToTable("Runs");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(40);
            e.Property(x => x.AppSlug).HasMaxLength(25);
            e.Property(x => x.AppName).HasMaxLength(40);
            e.Property(x => x.Mode).HasMaxLength(10);
            e.Property(x => x.Status).HasMaxLength(10);
            e.Property(x => x.StartedByOid).HasMaxLength(64);
            e.Property(x => x.Message).HasMaxLength(500);
            e.HasOne<AppEntity>().WithMany().HasForeignKey(x => x.AppSlug);
            e.HasIndex(x => new { x.AppSlug, x.StartedAt });
            e.HasIndex(x => x.Status);
        });
        model.Entity<RunEventEntity>(e =>
        {
            e.ToTable("RunEvents");
            e.HasKey(x => new { x.RunId, x.Seq });
            e.Property(x => x.RunId).HasMaxLength(40);
            e.Property(x => x.Json).HasMaxLength(4000);
            e.HasOne<RunEntity>().WithMany().HasForeignKey(x => x.RunId);
        });
        model.Entity<CheckEntity>(e =>
        {
            e.ToTable("Checks");
            e.HasKey(x => x.Id);
            e.Property(x => x.AppSlug).HasMaxLength(25);
            e.Property(x => x.Overall).HasMaxLength(20);
            e.HasOne<AppEntity>().WithMany().HasForeignKey(x => x.AppSlug);
            e.HasIndex(x => new { x.AppSlug, x.At });
        });
    }
}

public sealed class AppEntity
{
    public required string Slug { get; set; }
    public required string Name { get; set; }
    public required string Status { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public required string RequestedByOid { get; set; }
    public required string RequestedByName { get; set; }
    /// <summary>The normalized request of the latest run, as JSON (at most 64 KB).</summary>
    public required string RequestJson { get; set; }
}

public sealed class RunEntity
{
    public required string Id { get; set; }
    public required string AppSlug { get; set; }
    public required string AppName { get; set; }
    public required string Mode { get; set; }
    public required string Status { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }
    public required string StartedByOid { get; set; }
    public string? Message { get; set; }
}

public sealed class RunEventEntity
{
    public required string RunId { get; set; }
    public int Seq { get; set; }
    public required string Json { get; set; }
}

public sealed class CheckEntity
{
    public long Id { get; set; }
    public required string AppSlug { get; set; }
    public DateTimeOffset At { get; set; }
    public required string Overall { get; set; }
    public required string Json { get; set; }
}

/// <summary>Used by <c>dotnet ef</c> only, to create migrations without starting the app or connecting to a database.</summary>
public sealed class MerlinDbContextDesignFactory : Microsoft.EntityFrameworkCore.Design.IDesignTimeDbContextFactory<MerlinDbContext>
{
    public MerlinDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<MerlinDbContext>().UseSqlServer("Server=tcp:localhost;Database=merlin;Authentication=Active Directory Default;Encrypt=True;").Options);
}
