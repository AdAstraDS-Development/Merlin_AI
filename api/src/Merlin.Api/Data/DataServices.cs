using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

namespace Merlin.Api.Data;

/// <summary>The <c>Database</c> settings: <c>Kind</c> is <c>none</c> or <c>azure-sql</c>; the connection string uses managed identity, never a password.</summary>
public sealed class DatabaseOptions : IValidatableObject
{
    public string Kind { get; set; } = "none";
    public string ConnectionString { get; set; } = "";

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (Kind is not ("none" or "azure-sql")) yield return new ValidationResult("Database:Kind must be none or azure-sql.");
        if (Kind == "azure-sql" && string.IsNullOrWhiteSpace(ConnectionString)) yield return new ValidationResult("Set Database:ConnectionString when Database:Kind is azure-sql.");
        if (ConnectionString.Contains("password", StringComparison.OrdinalIgnoreCase) || ConnectionString.Contains("pwd=", StringComparison.OrdinalIgnoreCase))
            yield return new ValidationResult("Database:ConnectionString must not contain a password; use managed identity (Authentication=Active Directory Managed Identity or Default).");
    }
}

public static class DataServices
{
    /// <summary>Registers the registry: Azure SQL when configured, otherwise in memory, which only Development and Testing may use.</summary>
    public static IServiceCollection AddMerlinData(this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        services.AddOptions<DatabaseOptions>().Bind(configuration.GetSection("Database")).ValidateDataAnnotations().ValidateOnStart();
        var options = configuration.GetSection("Database").Get<DatabaseOptions>() ?? new DatabaseOptions();
        if (options.Kind != "azure-sql")
        {
            if (!environment.IsDevelopment() && !environment.IsEnvironment("Testing"))
                throw new InvalidOperationException("Database:Kind is none. The in-memory registry is only for Development; configure Database:Kind azure-sql.");
            services.AddSingleton<IAppRegistry, InMemoryAppRegistry>();
            return services;
        }
        // The serverless database pauses when idle; the first connection waits while it resumes.
        var connection = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(options.ConnectionString);
        if (connection.ConnectTimeout < 60) connection.ConnectTimeout = 60;
        services.AddDbContextFactory<MerlinDbContext>(db => db.UseSqlServer(connection.ConnectionString, sql => sql.EnableRetryOnFailure()));
        services.AddSingleton<IAppRegistry, SqlAppRegistry>();
        return services;
    }

    /// <summary>Applies pending migrations at startup whenever Azure SQL is configured. In Azure the app's managed identity is the
    /// Entra administrator (infrastructure/database.tf); a failed migration stops startup, so the deploy health check fails.</summary>
    public static async Task MigrateDatabaseAsync(this WebApplication app)
    {
        if (app.Services.GetService<IDbContextFactory<MerlinDbContext>>() is not { } factory) return;
        await using var db = await factory.CreateDbContextAsync();
        await db.Database.MigrateAsync();
    }
}
