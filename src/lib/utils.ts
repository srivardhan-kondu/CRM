import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export function formatINR(value: number): string {
  return inr.format(value);
}

const compactInr = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
export function formatCompactINR(value: number): string {
  return `₹${compactInr.format(value)}`;
}

const number = new Intl.NumberFormat("en-IN");
export function formatNumber(value: number): string {
  return number.format(value);
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}

/** Relative time against a fixed "now" so server and client render identically. */
export function formatRelative(iso: string, now: Date): string {
  const diffMs = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < hour) return rtf.format(Math.round(diffMs / minute), "minute");
  if (abs < day) return rtf.format(Math.round(diffMs / hour), "hour");
  if (abs < 30 * day) return rtf.format(Math.round(diffMs / day), "day");
  return formatDate(iso);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

/** "CSE-3-A" (department-year-section key) → "3-CSE-A" (how colleges write it). */
export function sectionLabel(sectionCode: string): string {
  const [dept, year, letter] = sectionCode.split("-");
  return dept && year && letter ? `${year}-${dept}-${letter}` : sectionCode;
}
