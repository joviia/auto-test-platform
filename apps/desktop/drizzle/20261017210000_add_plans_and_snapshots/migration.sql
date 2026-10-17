CREATE TABLE `suites` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suite_items` (
	`id` text PRIMARY KEY,
	`suite_id` text NOT NULL,
	`case_id` text NOT NULL,
	`idx` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`suite_id` text,
	`retries` integer DEFAULT 0 NOT NULL,
	`timeout_ms` integer DEFAULT 15000 NOT NULL,
	`continue_on_failure` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plan_items` (
	`id` text PRIMARY KEY,
	`plan_id` text NOT NULL,
	`case_id` text NOT NULL,
	`idx` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plan_runs` (
	`id` text PRIMARY KEY,
	`plan_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`total` integer NOT NULL,
	`passed` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
ALTER TABLE `runs` ADD COLUMN `plan_run_id` text;
--> statement-breakpoint
ALTER TABLE `runs` ADD COLUMN `attempt` integer;
--> statement-breakpoint
ALTER TABLE `runs` ADD COLUMN `case_snapshot` text;
