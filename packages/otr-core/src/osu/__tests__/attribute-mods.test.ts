import { describe, expect, it } from 'bun:test';

import {
  ATTRIBUTE_MODS_MASK,
  UNSUPPORTED_ATTRIBUTE_MODS,
  attributeModsKey,
} from '../attribute-mods';
import { Mods } from '../enums';

const { Easy, Hidden, HardRock, DoubleTime } = Mods;

const validCombos = [
  Mods.None,
  Easy,
  Hidden,
  HardRock,
  DoubleTime,
  Easy | Hidden,
  Easy | DoubleTime,
  Hidden | HardRock,
  Hidden | DoubleTime,
  HardRock | DoubleTime,
  Easy | Hidden | DoubleTime,
  Hidden | HardRock | DoubleTime,
];

describe('attribute mods', () => {
  it('stores EZ, HD, HR and DT', () => {
    expect(ATTRIBUTE_MODS_MASK).toBe(90);
  });

  it('leaves HT, FL, TD, RX and AP unsupported', () => {
    expect(UNSUPPORTED_ATTRIBUTE_MODS).toBe(9604);
  });
});

describe('attributeModsKey', () => {
  it('maps every valid combination to itself', () => {
    expect(validCombos).toHaveLength(12);

    for (const mods of validCombos) {
      expect(attributeModsKey(mods)).toBe(mods);
    }
  });

  it('ignores the order mods are combined in', () => {
    expect(attributeModsKey(HardRock | Hidden)).toBe(
      attributeModsKey(Hidden | HardRock)
    );
    expect(attributeModsKey(HardRock | Hidden)).toBe(24);
  });

  it('counts Nightcore as DoubleTime', () => {
    expect(attributeModsKey(Mods.Nightcore)).toBe(DoubleTime);
    expect(attributeModsKey(Mods.Nightcore | DoubleTime)).toBe(DoubleTime);
    expect(attributeModsKey(Mods.Nightcore | Hidden | HardRock)).toBe(
      Hidden | HardRock | DoubleTime
    );
  });

  it('drops mods that do not change difficulty', () => {
    const ignored = [
      Mods.NoFail,
      Mods.SuddenDeath,
      Mods.Perfect | Mods.SuddenDeath,
      Mods.SpunOut,
      Mods.ScoreV2,
      Mods.Autoplay,
      Mods.Mirror,
    ];

    for (const mods of ignored) {
      expect(attributeModsKey(mods)).toBe(Mods.None);
      expect(attributeModsKey(mods | Hidden | DoubleTime)).toBe(
        Hidden | DoubleTime
      );
    }
  });

  it('combines game and score mods', () => {
    const gameMods = Hidden | Mods.NoFail;
    const scoreMods = HardRock;

    expect(attributeModsKey(gameMods | scoreMods)).toBe(Hidden | HardRock);
  });

  it('returns null for plays with HT, FL, TD, RX or AP', () => {
    const unsupported = [
      Mods.HalfTime,
      Mods.Flashlight,
      Mods.TouchDevice,
      Mods.Relax,
      Mods.Relax2,
      Mods.Relax | HardRock,
      Mods.Relax2 | Hidden | DoubleTime,
      Mods.HalfTime | Hidden,
      Mods.Flashlight | Hidden | HardRock,
      Mods.TouchDevice | DoubleTime,
      Mods.Flashlight | Mods.Nightcore,
      Mods.HalfTime | Mods.Flashlight | Mods.TouchDevice,
    ];

    for (const mods of unsupported) {
      expect(attributeModsKey(mods)).toBeNull();
    }
  });
});
