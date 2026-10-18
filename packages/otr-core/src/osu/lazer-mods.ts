/**
 * A mod as osu!lazer reports it. Settings hold only what the player changed
 * from the mod's defaults, such as `{ speed_change: 1.2 }` on DT.
 */
export interface LazerMod {
  acronym: string;
  settings?: Record<string, unknown>;
}
