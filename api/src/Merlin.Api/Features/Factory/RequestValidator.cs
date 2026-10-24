using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Merlin.Api.Features.Factory;

/// <summary>
/// Server-side validation of a factory request: the rules of request.schema.json plus the platform allowlists
/// (ported from ai-sw-template/factory/portal/RequestValidator.cs). Returns the normalized request.
/// </summary>
public static partial class RequestValidator
{
    [GeneratedRegex("^[A-Z][A-Za-z0-9]{1,39}$")] private static partial Regex AppName();
    [GeneratedRegex("^[a-z][a-z0-9]*(-[a-z0-9]+)*$")] private static partial Regex Slug();
    [GeneratedRegex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")] private static partial Regex Guid();
    [GeneratedRegex("^[a-z0-9]+$")] private static partial Regex Region();
    [GeneratedRegex("^[a-z0-9]{4,8}$")] private static partial Regex Suffix();
    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9-]{0,38}$")] private static partial Regex Owner();
    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")] private static partial Regex Repo();
    [GeneratedRegex("^[A-Za-z0-9-]{1,39}$")] private static partial Regex Reviewer();
    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$")] private static partial Regex CostCenterId();
    [GeneratedRegex("^[a-z][a-z0-9-]{1,19}$")] private static partial Regex TierId();
    [GeneratedRegex("^https://\\S+$")] private static partial Regex Link();

    public sealed class Result
    {
        public Dictionary<string, string[]> Errors { get; } = [];
        public JsonObject? Request { get; set; }
        public bool Ok => Errors.Count == 0;
        public void Add(string path, string message) => Errors[path] = Errors.TryGetValue(path, out var cur) ? [.. cur, message] : [message];
    }

    private static bool HasControl(string s, bool allowNewlines) => s.Any(c => char.IsControl(c) && !(allowNewlines && c is '\n' or '\r' or '\t'));

    /// <param name="author">Display name of the signed-in user; the request's own author is ignored.</param>
    public static Result Validate(JsonNode? input, FactoryOptions cfg, string author)
    {
        var r = new Result();
        if (input is not JsonObject o) { r.Add("", "The request must be a JSON object."); return r; }

        void NoUnknown(JsonObject obj, string prefix, params string[] known)
        {
            foreach (var kv in obj)
                if (!known.Contains(kv.Key)) r.Add(prefix + kv.Key, "Unknown property.");
        }

        string? Str(JsonObject obj, string name, string path, bool required, int max, Regex? rx = null, string? rxMsg = null, int min = 0, bool multiline = false)
        {
            var node = obj[name];
            if (node is null) { if (required) r.Add(path, "This field is required."); return null; }
            if (node is not JsonValue v || !v.TryGetValue<string>(out var s)) { r.Add(path, "Must be text."); return null; }
            s = s.Trim();
            if (s.Length == 0) { if (required) r.Add(path, "This field is required."); return null; }
            if (s.Length > max) { r.Add(path, $"Must be at most {max} characters."); return null; }
            if (s.Length < min) { r.Add(path, $"Must be at least {min} characters."); return null; }
            if (HasControl(s, multiline)) { r.Add(path, "Contains control characters."); return null; }
            if (rx is not null && !rx.IsMatch(s)) { r.Add(path, rxMsg ?? "Invalid format."); return null; }
            return s;
        }

        string[] List(JsonObject obj, string name, string path, int maxItems, int maxLen, Regex? rx = null, string? rxMsg = null, Func<string, bool>? extra = null, string? extraMsg = null)
        {
            var node = obj[name];
            if (node is null) return [];
            if (node is not JsonArray a) { r.Add(path, "Must be a list."); return []; }
            if (a.Count > maxItems) { r.Add(path, $"At most {maxItems} entries."); return []; }
            var res = new List<string>();
            for (var i = 0; i < a.Count; i++)
            {
                if (a[i] is not JsonValue v || !v.TryGetValue<string>(out var s)) { r.Add($"{path}[{i}]", "Must be text."); continue; }
                s = s.Trim();
                if (s.Length == 0) continue;
                if (s.Length > maxLen) { r.Add($"{path}[{i}]", $"Must be at most {maxLen} characters."); continue; }
                if (HasControl(s, false)) { r.Add($"{path}[{i}]", "Contains control characters."); continue; }
                if (rx is not null && !rx.IsMatch(s)) { r.Add($"{path}[{i}]", rxMsg ?? "Invalid format."); continue; }
                if (extra is not null && !extra(s)) { r.Add($"{path}[{i}]", extraMsg ?? "Invalid value."); continue; }
                if (!res.Contains(s, StringComparer.Ordinal)) res.Add(s);
            }
            return [.. res];
        }

        NoUnknown(o, "", "appName", "appSlug", "author", "description", "problem", "outcome", "users", "useCases", "constraints", "documentLinks", "billing", "azure", "github", "options");

        var appName = Str(o, "appName", "appName", true, 40, AppName(), "Use PascalCase letters and digits, 2 to 40 characters, starting with a capital letter (for example FleetPortal).");
        var appSlug = Str(o, "appSlug", "appSlug", true, 25, Slug(), "Use lowercase letters, digits and single hyphens, starting with a letter (for example fleet-portal).", 3);
        var description = Str(o, "description", "description", false, 16000, multiline: true);
        var problem = Str(o, "problem", "problem", false, 2000, multiline: true);
        var outcome = Str(o, "outcome", "outcome", false, 2000, multiline: true);
        var users = List(o, "users", "users", 30, 200);
        var useCases = List(o, "useCases", "useCases", 50, 300);
        var constraints = List(o, "constraints", "constraints", 30, 300);
        var links = List(o, "documentLinks", "documentLinks", 20, 2000, Link(), "Must be an https:// link.",
            s => Uri.TryCreate(s, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps && !string.IsNullOrEmpty(u.Host), "Must be a valid https:// link.");

        var azureOut = new JsonObject();
        var envs = new List<string>();
        if (o["azure"] is not JsonObject az) r.Add("azure", "This section is required.");
        else
        {
            NoUnknown(az, "azure.", "tenantId", "subscriptionId", "region", "nameSuffix", "environments");
            var tenant = Str(az, "tenantId", "azure.tenantId", true, 36, Guid(), "Must be a GUID.");
            if (tenant is not null && !cfg.Tenants.Contains(tenant, StringComparer.OrdinalIgnoreCase)) { r.Add("azure.tenantId", "This tenant is not on the platform allowlist."); tenant = null; }
            var sub = Str(az, "subscriptionId", "azure.subscriptionId", true, 36, Guid(), "Must be a GUID.");
            if (sub is not null && !cfg.Subscriptions.Any(s => s.Id.Equals(sub, StringComparison.OrdinalIgnoreCase))) { r.Add("azure.subscriptionId", "This subscription is not on the platform allowlist."); sub = null; }
            var region = Str(az, "region", "azure.region", true, 40, Region(), "Use a lowercase Azure region name such as westeurope.");
            if (region is not null && !cfg.Regions.Contains(region, StringComparer.Ordinal)) { r.Add("azure.region", "This region is not on the platform allowlist."); region = null; }
            var suffix = Str(az, "nameSuffix", "azure.nameSuffix", true, 8, Suffix(), "Use 4 to 8 lowercase letters or digits.", 4);
            if (az["environments"] is not JsonArray ea || ea.Count == 0) r.Add("azure.environments", "Select at least the development environment.");
            else
            {
                foreach (var e in ea)
                {
                    var s = e is JsonValue ev && ev.TryGetValue<string>(out var t) ? t : null;
                    if (s is not ("development" or "production")) { r.Add("azure.environments", "Only development and production are supported."); continue; }
                    if (envs.Contains(s)) { r.Add("azure.environments", "Environments must be unique."); continue; }
                    envs.Add(s);
                }
                if (envs.Count > 0 && !envs.Contains("development")) r.Add("azure.environments", "The development environment is required.");
            }
            if (tenant is not null) azureOut["tenantId"] = tenant.ToLowerInvariant();
            if (sub is not null) azureOut["subscriptionId"] = sub.ToLowerInvariant();
            if (region is not null) azureOut["region"] = region;
            if (suffix is not null) azureOut["nameSuffix"] = suffix;
            azureOut["environments"] = Arr([.. envs.OrderBy(x => x == "production" ? 1 : 0)]);
        }

        JsonObject? billingOut = null;
        if (o["billing"] is JsonObject bo)
        {
            NoUnknown(bo, "billing.", "costCenter", "tier");
            var cc = Str(bo, "costCenter", "billing.costCenter", true, 40, CostCenterId(), "Use letters, digits, dots, underscores and hyphens.");
            var tier = Str(bo, "tier", "billing.tier", true, 20, TierId(), "Use a tier id such as standard.");
            if (cc is not null && cfg.Billing is { CostCenters.Length: > 0 } && !cfg.Billing.CostCenters.Any(c => c.Id == cc)) { r.Add("billing.costCenter", "This cost center is not on the platform list."); cc = null; }
            var t = tier is null ? null : cfg.Billing?.Tiers.FirstOrDefault(x => x.Id == tier);
            if (tier is not null && t is null) { r.Add("billing.tier", "This tier is not offered."); tier = null; }
            if (t is { Production: false } && envs.Contains("production")) { r.Add("azure.environments", $"The {t.Name} tier has no production environment."); tier = null; }
            if (cc is not null && tier is not null) billingOut = new JsonObject { ["costCenter"] = cc, ["tier"] = tier };
        }
        else if (o["billing"] is not null) r.Add("billing", "Must be an object.");
        else if (cfg.Billing is not null) r.Add("billing.costCenter", "Choose who pays for the app.");

        var ghOut = new JsonObject();
        if (o["github"] is not JsonObject gh) r.Add("github", "This section is required.");
        else
        {
            NoUnknown(gh, "github.", "owner", "repoName", "visibility", "productionReviewers");
            var owner = Str(gh, "owner", "github.owner", true, 39, Owner(), "Use letters, digits and hyphens.");
            if (owner is not null && !cfg.AllowedOwners.Contains(owner, StringComparer.OrdinalIgnoreCase)) { r.Add("github.owner", "This owner is not on the platform allowlist."); owner = null; }
            var repo = Str(gh, "repoName", "github.repoName", true, 100, Repo(), "Use letters, digits, dots, underscores and hyphens, starting with a letter or digit.");
            if (repo is not null && (repo.EndsWith(".git", StringComparison.OrdinalIgnoreCase) || repo.Equals(".github", StringComparison.OrdinalIgnoreCase) || repo.Equals(".github-private", StringComparison.OrdinalIgnoreCase)))
            { r.Add("github.repoName", "This repository name is not allowed."); repo = null; }
            var vis = Str(gh, "visibility", "github.visibility", false, 10) ?? "private";
            if (vis is not ("private" or "internal")) { r.Add("github.visibility", "Choose private or internal."); vis = "private"; }
            var reviewers = List(gh, "productionReviewers", "github.productionReviewers", 6, 39, Reviewer(), "Use a GitHub user name.");
            if (envs.Contains("production") && reviewers.Length == 0) r.Add("github.productionReviewers", "Add at least one reviewer for production releases.");
            if (owner is not null) ghOut["owner"] = owner;
            if (repo is not null) ghOut["repoName"] = repo;
            ghOut["visibility"] = vis;
            ghOut["productionReviewers"] = Arr(reviewers);
        }

        var optOut = new JsonObject { ["protectMain"] = true, ["runLocalValidation"] = false, ["database"] = "none" };
        if (o["options"] is JsonObject op)
        {
            NoUnknown(op, "options.", "protectMain", "runLocalValidation", "database");
            if (op["database"] is { } dbn)
            {
                if (dbn is JsonValue dv && dv.TryGetValue<string>(out var db) && (db == "none" || cfg.Databases.Contains(db, StringComparer.Ordinal))) optOut["database"] = db;
                else r.Add("options.database", "This database is not offered by the platform.");
            }
            foreach (var n in new[] { "protectMain", "runLocalValidation" })
                if (op[n] is { } x)
                {
                    if (x is JsonValue bv && bv.TryGetValue<bool>(out var b)) optOut[n] = b;
                    else r.Add("options." + n, "Must be true or false.");
                }
        }
        else if (o["options"] is not null) r.Add("options", "Must be an object.");

        if (!r.Ok) return r;

        var res = new JsonObject { ["appName"] = appName, ["appSlug"] = appSlug, ["author"] = author };
        if (description is not null) res["description"] = description;
        if (problem is not null) res["problem"] = problem;
        if (outcome is not null) res["outcome"] = outcome;
        res["users"] = Arr(users);
        res["useCases"] = Arr(useCases);
        res["constraints"] = Arr(constraints);
        res["documentLinks"] = Arr(links);
        if (billingOut is not null) res["billing"] = billingOut;
        res["azure"] = azureOut;
        res["github"] = ghOut;
        res["options"] = optOut;
        r.Request = res;
        return r;
    }

    /// <summary>Where an app runs is a platform decision: people without the admin role get the defaults. Null when nothing is locked.</summary>
    public static Dictionary<string, string[]>? TargetLock(JsonObject request, FactoryOptions cfg, bool isAdmin, string prefix = "")
    {
        if (isAdmin) return null;
        const string msg = "Only platform admins can change where an app runs.";
        var e = new Dictionary<string, string[]>();
        static bool Is(JsonNode? n, string? expected) => string.Equals(n?.GetValue<string>(), expected, StringComparison.OrdinalIgnoreCase);
        if (!Is(request["azure"]?["tenantId"], cfg.Tenants.FirstOrDefault())) e[prefix + "azure.tenantId"] = [msg];
        if (!Is(request["azure"]?["subscriptionId"], cfg.Subscriptions.FirstOrDefault()?.Id)) e[prefix + "azure.subscriptionId"] = [msg];
        if (!Is(request["azure"]?["region"], cfg.Regions.FirstOrDefault())) e[prefix + "azure.region"] = [msg];
        if (!Is(request["github"]?["owner"], cfg.AllowedOwners.FirstOrDefault())) e[prefix + "github.owner"] = [msg];
        if (!Is(request["github"]?["repoName"], request["appSlug"]?.GetValue<string>())) e[prefix + "github.repoName"] = [msg];
        if (!Is(request["github"]?["visibility"], "private")) e[prefix + "github.visibility"] = [msg];
        if (request["options"]?["protectMain"]?.GetValue<bool>() != true || request["options"]?["runLocalValidation"]?.GetValue<bool>() == true) e[prefix + "options"] = [msg];
        return e.Count > 0 ? e : null;
    }

    private static readonly JsonSerializerOptions FingerprintJson = new() { WriteIndented = true, NewLine = "\n" };

    /// <summary>SHA-256 of the normalized request, as the factory issue and the approver see it.</summary>
    public static string Fingerprint(JsonObject request) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(request.ToJsonString(FingerprintJson))));

    private static JsonArray Arr(string[] a) => new([.. a.Select(x => (JsonNode)JsonValue.Create(x))]);
}
