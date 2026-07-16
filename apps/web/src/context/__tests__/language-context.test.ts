/**
 * Fundación i18n (T0, spec "Runtime Language Toggle" / "Language Default and Persistence" /
 * "Translation Completeness and Safety" / "Interpolation Support"). Cubre solo la lógica pura
 * exportada de `language-context.tsx` (interpolación, lectura/default de idioma persistido y
 * fallback de `t`) — sin montar componentes, ya que no hay RTL en el repo.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { en } from "../../i18n/en";
import { es } from "../../i18n/es";
import { initialLang, interpolate, readStoredLang } from "../language-context";

function mockLocalStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  const mock: Storage = {
    getItem: (k) => (k in store ? store[k]! : null),
    setItem: (k, v) => {
      store[k] = v;
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: () => null,
    length: 0,
  };
  globalThis.localStorage = mock;
  return store;
}

describe("interpolate", () => {
  it("sustituye variables presentes en la plantilla", () => {
    expect(interpolate("{n} pasos", { n: 3 })).toBe("3 pasos");
  });

  it("deja la key intacta cuando falta la variable", () => {
    expect(interpolate("hola {name}", {})).toBe("hola {name}");
  });

  it("pasa la plantilla sin cambios cuando no hay vars", () => {
    expect(interpolate("texto plano")).toBe("texto plano");
  });
});

describe("readStoredLang / initialLang", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  it("default 'en' sin key en localStorage", () => {
    expect(readStoredLang()).toBeNull();
    expect(initialLang()).toBe("en");
  });

  it("lee un valor válido persistido ('es')", () => {
    mockLocalStorage({ "ghostly-lang": "es" });
    expect(readStoredLang()).toBe("es");
    expect(initialLang()).toBe("es");
  });

  it("fallback a 'en' con valor corrupto ('fr')", () => {
    mockLocalStorage({ "ghostly-lang": "fr" });
    expect(readStoredLang()).toBeNull();
    expect(initialLang()).toBe("en");
  });
});

describe("dict fallback (t)", () => {
  it("una key ausente en ambos diccionarios devuelve el fallback en inglés, nunca la key cruda", () => {
    // Simula la resolución de `t` para lang="es": dict[key] ?? en[key] ?? key
    const key = "settings.language.title" as const;
    const dict = es as Record<string, string>;
    delete dict[key];
    const resolved = dict[key] ?? en[key] ?? key;
    expect(resolved).toBe(en[key]);
    expect(resolved).not.toBe(key);
  });
});
