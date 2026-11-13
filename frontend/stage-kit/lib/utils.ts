import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** Joins class names and lets the last Tailwind class of each kind win, as shadcn components expect. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
