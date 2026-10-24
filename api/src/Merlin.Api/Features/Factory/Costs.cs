using System.Text.Json.Nodes;

namespace Merlin.Api.Features.Factory;

/// <summary>
/// Simulated cost model (ported from ai-sw-template/factory/portal/Costs.cs): tier price and database price per environment,
/// platform fee and developer seats. Month-to-date values are derived from the slug and the date until Cost Management is connected.
/// </summary>
public static class Costs
{
    private static readonly string[] Running = ["live", "degraded", "simulated"];

    public static JsonObject? Estimate(FactoryOptions cfg, string? costCenterId, string? tierId, int environments, int seats, string? database)
    {
        var b = cfg.Billing;
        var tier = b?.Tiers.FirstOrDefault(t => t.Id == tierId);
        if (b is null || tier is null) return null;
        var envs = Math.Max(environments, 1);
        var dbPrice = database is not null && b.DatabaseMonthlyPerEnvironment.TryGetValue(database, out var dp) ? dp : 0m;
        var azure = (tier.MonthlyPerEnvironment + dbPrice) * envs;
        var fee = Math.Round(azure * b.PlatformFeePercent / 100m, 2);
        var seatCost = b.SeatFeePerMonth * seats;
        return new JsonObject
        {
            ["simulated"] = b.Simulated,
            ["free"] = b.Free,
            ["database"] = database ?? "none",
            ["databaseMonthly"] = dbPrice * envs,
            ["currency"] = b.Currency,
            ["tier"] = new JsonObject { ["id"] = tier.Id, ["name"] = tier.Name, ["expiresDays"] = tier.ExpiresDays },
            ["costCenter"] = string.IsNullOrEmpty(costCenterId) ? null
                : new JsonObject { ["id"] = costCenterId, ["name"] = b.CostCenters.FirstOrDefault(c => c.Id == costCenterId)?.Name ?? "" },
            ["environments"] = environments,
            ["azureMonthly"] = azure,
            ["platformFeePercent"] = b.PlatformFeePercent,
            ["platformFee"] = fee,
            ["seats"] = seats,
            ["seatFee"] = b.SeatFeePerMonth,
            ["seatCost"] = seatCost,
            ["totalMonthly"] = azure + fee + seatCost,
        };
    }

    /// <summary>Monthly estimate for a normalized request; the requester and each production reviewer count as seats.</summary>
    public static JsonObject? ForRequest(FactoryOptions cfg, JsonObject request) =>
        Estimate(cfg, Str(request["billing"]?["costCenter"]), Str(request["billing"]?["tier"]),
            (request["azure"]?["environments"] as JsonArray)?.Count ?? 1,
            1 + ((request["github"]?["productionReviewers"] as JsonArray)?.Count ?? 0), Str(request["options"]?["database"]));

    /// <summary>Estimate for an app plus simulated month-to-date, forecast and budget state while it runs.</summary>
    public static JsonObject? ForApp(FactoryOptions cfg, JsonObject request, string status, DateTimeOffset createdAt, DateTimeOffset now)
    {
        var est = ForRequest(cfg, request);
        if (est is null) return null;
        if (Running.Contains(status))
        {
            // A stable per-app factor between 0.80 and 1.15 makes the simulation look like real, varying usage.
            var slug = Str(request["appSlug"]) ?? "";
            var factor = 0.80m + ((uint)slug.Aggregate(17, (h, c) => unchecked(h * 31 + c)) % 36) / 100m;
            var days = DateTime.DaysInMonth(now.Year, now.Month);
            var start = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, TimeSpan.Zero);
            if (createdAt > start) start = createdAt;
            var share = Math.Clamp((decimal)(now - start).TotalDays / days, 0m, 1m);
            var azure = est["azureMonthly"]!.GetValue<decimal>();
            var pct = est["platformFeePercent"]!.GetValue<decimal>() / 100m;
            var seatCost = est["seatCost"]!.GetValue<decimal>();
            var mtd = Math.Round(azure * factor * share, 2);
            var forecast = Math.Round(azure * factor, 2);
            est["monthToDate"] = mtd;
            est["forecast"] = forecast;
            est["budget"] = azure;
            est["budgetState"] = forecast > azure ? "over" : forecast > azure * 0.9m ? "near" : "ok";
            est["chargeMonthToDate"] = Math.Round(mtd * (1 + pct) + seatCost * share, 2);
            est["chargeForecast"] = Math.Round(forecast * (1 + pct) + seatCost, 2);
        }
        if (est["tier"]!["expiresDays"] is JsonValue ev && ev.TryGetValue<int>(out var exp)) est["expiresAt"] = createdAt.AddDays(exp).ToString("o");
        return est;
    }

    private static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
}
