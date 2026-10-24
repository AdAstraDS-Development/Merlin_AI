using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Merlin.Api.Data;
using Merlin.Api.Features.Factory;
using Merlin.Api.Infrastructure.Auth;

var builder = WebApplication.CreateBuilder(args);
var auth = builder.Configuration.GetSection("Auth");
var tenant = auth["TenantId"];
var client = auth["ClientId"];
var secret = auth["ClientSecret"];
var origin = auth["PublicOrigin"];
var loginEnabled = new[] { tenant, client, secret, origin }.Any(value => !string.IsNullOrWhiteSpace(value));
if (loginEnabled && (!Guid.TryParse(tenant, out _) || !Guid.TryParse(client, out _) || string.IsNullOrWhiteSpace(secret)
    || !Uri.TryCreate(origin, UriKind.Absolute, out var publicUri) || publicUri.Scheme != "https"
    || publicUri.AbsolutePath != "/" || publicUri.Query.Length > 0 || publicUri.Fragment.Length > 0 || publicUri.UserInfo.Length > 0))
    throw new InvalidOperationException("Configure all Auth values with GUID tenant/client IDs and an HTTPS PublicOrigin without a path, query, fragment or credentials.");
origin = origin?.TrimEnd('/');
var home = Environment.GetEnvironmentVariable("HOME");
var state = builder.Configuration["StateDirectory"] ?? (string.IsNullOrEmpty(home)
    ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "merlin", "state")
    : Path.Combine(home, ".merlin", "state"));
var keys = Directory.CreateDirectory(Path.Combine(state, "keys"));
builder.Services.AddDataProtection().SetApplicationName("merlin").PersistKeysToFileSystem(keys);
builder.Services.AddSingleton(sp => new FileTicketStore(Path.Combine(state, "tickets"), sp.GetRequiredService<IDataProtectionProvider>(), TimeProvider.System));
builder.Services.AddHostedService<TicketCleanup>();
builder.Services.AddProblemDetails();
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-CSRF-TOKEN";
    options.Cookie.Name = "__Host-merlin-csrf";
    options.Cookie.HttpOnly = true;
    options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    options.Cookie.SameSite = SameSiteMode.Strict;
});
var authentication = builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(options =>
{
    options.Cookie.Name = "__Host-merlin-session";
    options.Cookie.HttpOnly = true;
    options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.ExpireTimeSpan = TimeSpan.FromHours(8);
    options.SlidingExpiration = false;
    options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
    options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.AddOptions<CookieAuthenticationOptions>(CookieAuthenticationDefaults.AuthenticationScheme)
    .Configure<FileTicketStore>((options, store) => options.SessionStore = store);
if (loginEnabled)
{
    authentication.AddOpenIdConnect(options =>
    {
        options.Authority = $"https://login.microsoftonline.com/{tenant}/v2.0";
        options.ClientId = client;
        options.ClientSecret = secret;
        options.ResponseType = OpenIdConnectResponseType.Code;
        options.UsePkce = true;
        options.SaveTokens = false;
        options.CallbackPath = "/api/auth/callback";
        options.SignedOutCallbackPath = "/api/auth/signed-out";
        options.MapInboundClaims = false;
        options.TokenValidationParameters.NameClaimType = "name";
        options.TokenValidationParameters.RoleClaimType = "roles";
        options.Scope.Clear();
        options.Scope.Add("openid");
        options.Scope.Add("profile");
        options.Events.OnRedirectToIdentityProvider = context =>
        {
            context.ProtocolMessage.RedirectUri = origin + "/api/auth/callback";
            return Task.CompletedTask;
        };
        options.Events.OnRemoteFailure = context =>
        {
            context.HandleResponse();
            context.Response.Redirect("/?login=failed");
            return Task.CompletedTask;
        };
    });
}
builder.Services.AddAuthorization();
builder.Services.AddMerlinData(builder.Configuration, builder.Environment);
builder.Services.AddFactory(builder.Configuration);
var app = builder.Build();
app.UseExceptionHandler();
app.UseStatusCodePages();
if (!app.Environment.IsDevelopment()) app.UseHsts();
app.Use(async (context, next) =>
{
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
    if (context.Request.Path.StartsWithSegments("/api") || context.Request.Path.StartsWithSegments("/app"))
        context.Response.Headers.CacheControl = "no-store";
    await next();
});
app.UseAuthentication();
app.UseAuthorization();
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/app") && context.User.Identity?.IsAuthenticated != true)
    {
        context.Response.Redirect(loginEnabled ? "/api/auth/login" : "/");
        return;
    }
    await next();
});
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapGet("/health/live", () => Results.Ok(new { status = "Healthy" })).AllowAnonymous();
app.MapGet("/api/config", () => Results.Ok(new { applicationName = builder.Configuration["ApplicationName"], loginEnabled })).AllowAnonymous();
app.MapGet("/api/auth/login", () => loginEnabled
    ? Results.Challenge(new AuthenticationProperties { RedirectUri = "/app" }, [OpenIdConnectDefaults.AuthenticationScheme])
    : Results.Problem(statusCode: 503, title: "Sign-in is not configured.")).AllowAnonymous();
app.MapGet("/api/me", (HttpContext context) => Results.Ok(new { name = context.User.Identity?.Name ?? "Signed-in user" })).RequireAuthorization();
app.MapGet("/api/auth/csrf", (HttpContext context, IAntiforgery antiforgery) =>
    Results.Ok(new { requestToken = antiforgery.GetAndStoreTokens(context).RequestToken })).RequireAuthorization();
app.MapPost("/api/auth/logout", async (HttpContext context) =>
{
    await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    // No tokens are retained; terminate the local server session, then the Entra SSO session.
    var redirectUrl = loginEnabled ? $"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/logout?post_logout_redirect_uri={Uri.EscapeDataString(origin + "/")}" : "/";
    return Results.Ok(new { redirectUrl });
}).RequireAuthorization().RequireCsrf();
app.MapPost("/api/private/ping", () => Results.Ok(new { ok = true })).RequireAuthorization().RequireCsrf();
app.MapFactory();
app.MapFallback("/api/{**path}", () => Results.Problem(statusCode: 404, title: "API endpoint not found."));
app.MapFallbackToFile("index.html");
await app.MigrateDatabaseAsync();
app.Run();

public partial class Program { }
