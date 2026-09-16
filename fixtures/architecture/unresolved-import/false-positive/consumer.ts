import { value } from "./present.js";
import express from "express";

export function useValue(): number {
  return value + (express ? 1 : 0);
}
