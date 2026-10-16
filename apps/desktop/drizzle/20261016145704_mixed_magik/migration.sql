CREATE TABLE `case_steps` (
	`id` text PRIMARY KEY,
	`case_id` text NOT NULL,
	`idx` integer NOT NULL,
	`action` text NOT NULL,
	`element_id` text,
	`params` text,
	`assertion` text
);
--> statement-breakpoint
CREATE TABLE `cases` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`module_id` text,
	`name` text NOT NULL,
	`start_url` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `elements` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`locators` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `modules` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `run_steps` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`idx` integer NOT NULL,
	`step_id` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`error` text,
	`locator_hit` text,
	`tried_candidates` text,
	`assertion` text,
	`screenshot_path` text
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY,
	`case_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`video_path` text,
	`error` text
);
