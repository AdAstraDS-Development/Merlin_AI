using System.ComponentModel.DataAnnotations;

namespace Merlin.Api.Features.Factory;

/// <summary>Platform allowlists, billing and roles from the <c>Factory</c> settings (the template's factory.config.json).</summary>
public sealed class FactoryOptions : IValidatableObject
{
    public string GithubHost { get; set; } = "github.com";
    public string[] AllowedOwners { get; set; } = [];
    public string[] Tenants { get; set; } = [];
    public SubscriptionInfo[] Subscriptions { get; set; } = [];
    public string[] Regions { get; set; } = [];
    public string[] Databases { get; set; } = [];
    public string SharedStateAccount { get; set; } = "";
    public string SharedStateGroup { get; set; } = "";
    /// <summary>Entra app role whose members may change where an app runs and start the sample simulation.</summary>
    public string AdminRole { get; set; } = "Factory.Admin";
    public BillingOptions? Billing { get; set; }
    public GitHubOptions GitHub { get; set; } = new();
    /// <summary>Pause between dry-run steps, so people can watch the run; 0 in tests.</summary>
    [Range(0, 10_000)] public int DryRunStepDelayMs { get; set; } = 400;

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (AllowedOwners.Length == 0 || Tenants.Length == 0 || Subscriptions.Length == 0 || Regions.Length == 0)
            yield return new ValidationResult("Configure Factory:AllowedOwners, Factory:Tenants, Factory:Subscriptions and Factory:Regions.");
        if (Billing is { Tiers.Length: 0 }) yield return new ValidationResult("Factory:Billing needs at least one tier.");
        foreach (var result in GitHub.Validate()) yield return result;
    }
}

public sealed class SubscriptionInfo
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
}

public sealed class BillingOptions
{
    public bool Simulated { get; set; } = true;
    public bool Free { get; set; }
    public string Currency { get; set; } = "EUR";
    public decimal PlatformFeePercent { get; set; }
    public decimal SeatFeePerMonth { get; set; }
    public Dictionary<string, decimal> DatabaseMonthlyPerEnvironment { get; set; } = [];
    public CostCenter[] CostCenters { get; set; } = [];
    public Tier[] Tiers { get; set; } = [];
}

public sealed class CostCenter
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
}

public sealed class Tier
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public decimal MonthlyPerEnvironment { get; set; }
    public bool Production { get; set; } = true;
    public int? ExpiresDays { get; set; }
    public string Summary { get; set; } = "";
}
