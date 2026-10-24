using Microsoft.AspNetCore.Antiforgery;

namespace Merlin.Api.Infrastructure.Auth;

public static class CsrfEndpointFilter
{
    // Requires a valid X-CSRF-TOKEN header; apply to every state-changing endpoint or route group.
    public static TBuilder RequireCsrf<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder =>
        builder.AddEndpointFilter(async (invocation, next) =>
        {
            try { await invocation.HttpContext.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(invocation.HttpContext); }
            catch (AntiforgeryValidationException) { return Results.Problem(statusCode: 400, title: "CSRF validation failed."); }
            return await next(invocation);
        });
}
