using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;

namespace Merlin.Api.Infrastructure.Auth;

// Persisted, encrypted tickets support restarts on ONE App Service instance.
public sealed class FileTicketStore : ITicketStore
{
    private readonly string _directory;
    private readonly IDataProtector _protector;
    private readonly TimeProvider _clock;
    private readonly SemaphoreSlim _gate = new(1, 1);
    public FileTicketStore(string directory, IDataProtectionProvider protection, TimeProvider clock)
    {
        _directory = directory;
        Directory.CreateDirectory(directory);
        _protector = protection.CreateProtector("Merlin.ServerTickets.v1");
        _clock = clock;
    }
    public async Task<string> StoreAsync(AuthenticationTicket ticket)
    {
        var key = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        await RenewAsync(key, ticket);
        return key;
    }
    public async Task RenewAsync(string key, AuthenticationTicket ticket)
    {
        await _gate.WaitAsync();
        try
        {
            var path = TicketPath(key);
            var temp = path + ".tmp";
            await File.WriteAllBytesAsync(temp, _protector.Protect(TicketSerializer.Default.Serialize(ticket)));
            File.Move(temp, path, true);
        }
        finally { _gate.Release(); }
    }
    public async Task<AuthenticationTicket?> RetrieveAsync(string key)
    {
        await _gate.WaitAsync();
        try { return await ReadAsync(TicketPath(key)); }
        finally { _gate.Release(); }
    }
    private async Task<AuthenticationTicket?> ReadAsync(string path)
    {
        if (!File.Exists(path)) return null;
        try
        {
            var ticket = TicketSerializer.Default.Deserialize(_protector.Unprotect(await File.ReadAllBytesAsync(path)));
            if (ticket?.Properties.ExpiresUtc > _clock.GetUtcNow()) return ticket;
        }
        catch (CryptographicException) { }
        File.Delete(path);
        return null;
    }
    public async Task RemoveAsync(string key)
    {
        await _gate.WaitAsync();
        try { File.Delete(TicketPath(key)); }
        finally { _gate.Release(); }
    }
    public async Task PruneAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            foreach (var path in Directory.EnumerateFiles(_directory, "*.ticket"))
            {
                ct.ThrowIfCancellationRequested();
                await ReadAsync(path);
            }
        }
        finally { _gate.Release(); }
    }
    private string TicketPath(string key)
    {
        if (key.Length != 64 || key.Any(c => !Uri.IsHexDigit(c))) throw new ArgumentException("Invalid session identifier.", nameof(key));
        return Path.Combine(_directory, key + ".ticket");
    }
}

public sealed class TicketCleanup(FileTicketStore tickets, ILogger<TicketCleanup> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(30));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                try { await tickets.PruneAsync(stoppingToken); }
                catch (IOException ex) { logger.LogError(ex, "Session cleanup failed"); }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}
