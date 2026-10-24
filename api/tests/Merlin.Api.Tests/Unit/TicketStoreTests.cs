using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.DataProtection;
using Merlin.Api.Infrastructure.Auth;

namespace Merlin.Api.Tests.Unit;

public sealed class TicketStoreTests
{
    [Fact]
    public async Task TicketsSurviveRestartExpireAndCanBeRevoked()
    {
        var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        try
        {
            var keys = Directory.CreateDirectory(Path.Combine(path, "keys"));
            var provider = DataProtectionProvider.Create(keys);
            var store = new FileTicketStore(Path.Combine(path, "tickets"), provider, TimeProvider.System);
            var ticket = new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "Sensitive name")], "test")), new AuthenticationProperties { ExpiresUtc = DateTimeOffset.UtcNow.AddHours(1) }, "Cookies");
            var key = await store.StoreAsync(ticket);
            Assert.DoesNotContain("Sensitive name", await File.ReadAllTextAsync(Path.Combine(path, "tickets", key + ".ticket"), TestContext.Current.CancellationToken));
            var restarted = new FileTicketStore(Path.Combine(path, "tickets"), DataProtectionProvider.Create(keys), TimeProvider.System);
            Assert.NotNull(await restarted.RetrieveAsync(key));
            ticket.Properties.ExpiresUtc = DateTimeOffset.UtcNow.AddSeconds(-1);
            await restarted.RenewAsync(key, ticket);
            Assert.Null(await restarted.RetrieveAsync(key));
            ticket.Properties.ExpiresUtc = DateTimeOffset.UtcNow.AddHours(1);
            var next = await restarted.StoreAsync(ticket);
            await restarted.RemoveAsync(next);
            Assert.Null(await restarted.RetrieveAsync(next));
            await Assert.ThrowsAsync<ArgumentException>(() => restarted.RetrieveAsync("../escape"));
        }
        finally { if (Directory.Exists(path)) Directory.Delete(path, true); }
    }
}
