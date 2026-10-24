using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Merlin.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class UC03_FactoryRegistry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "factory");

            migrationBuilder.CreateTable(
                name: "Apps",
                schema: "factory",
                columns: table => new
                {
                    Slug = table.Column<string>(type: "nvarchar(25)", maxLength: 25, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    RequestedByOid = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    RequestedByName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    RequestJson = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Apps", x => x.Slug);
                });

            migrationBuilder.CreateTable(
                name: "Checks",
                schema: "factory",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    AppSlug = table.Column<string>(type: "nvarchar(25)", maxLength: 25, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Overall = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Json = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Checks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Checks_Apps_AppSlug",
                        column: x => x.AppSlug,
                        principalSchema: "factory",
                        principalTable: "Apps",
                        principalColumn: "Slug",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Runs",
                schema: "factory",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    AppSlug = table.Column<string>(type: "nvarchar(25)", maxLength: 25, nullable: false),
                    AppName = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    Mode = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    FinishedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    StartedByOid = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Message = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Runs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Runs_Apps_AppSlug",
                        column: x => x.AppSlug,
                        principalSchema: "factory",
                        principalTable: "Apps",
                        principalColumn: "Slug",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "RunEvents",
                schema: "factory",
                columns: table => new
                {
                    RunId = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    Seq = table.Column<int>(type: "int", nullable: false),
                    Json = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RunEvents", x => new { x.RunId, x.Seq });
                    table.ForeignKey(
                        name: "FK_RunEvents_Runs_RunId",
                        column: x => x.RunId,
                        principalSchema: "factory",
                        principalTable: "Runs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Checks_AppSlug_At",
                schema: "factory",
                table: "Checks",
                columns: new[] { "AppSlug", "At" });

            migrationBuilder.CreateIndex(
                name: "IX_Runs_AppSlug_StartedAt",
                schema: "factory",
                table: "Runs",
                columns: new[] { "AppSlug", "StartedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Runs_Status",
                schema: "factory",
                table: "Runs",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Checks",
                schema: "factory");

            migrationBuilder.DropTable(
                name: "RunEvents",
                schema: "factory");

            migrationBuilder.DropTable(
                name: "Runs",
                schema: "factory");

            migrationBuilder.DropTable(
                name: "Apps",
                schema: "factory");
        }
    }
}
