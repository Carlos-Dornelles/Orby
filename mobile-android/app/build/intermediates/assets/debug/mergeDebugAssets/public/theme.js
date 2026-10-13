window.orbyThemeStorageKey = "orby-theme-v1";
window.orbyCustomThemeStorageKey = "orby-custom-theme-v1";

const propriedadesCorTemaPersonalizado = [
  "--ui-primary",
  "--ui-primary-light",
  "--ui-primary-dark",
  "--ui-primary-text",
  "--ui-primary-soft",
  "--ui-primary-soft-strong",
  "--ui-primary-border",
  "--ui-primary-hover",
  "--ui-primary-hover-dark"
];

window.orbyApplyCustomTheme = (color, mode) => {
  if (typeof color !== "string" || !/^#[\da-f]{6}$/i.test(color)) {
    throw new TypeError("A cor do tema personalizado deve estar no formato hexadecimal.");
  }
  if (mode !== "light" && mode !== "dark") {
    throw new TypeError("O modo do tema personalizado deve ser claro ou escuro.");
  }

  const toRgb = hex => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16)
  ];
  const toHex = rgb => `#${rgb.map(value => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
  const blend = (from, to, amount) => {
    const source = toRgb(from);
    const target = toRgb(to);
    return toHex(source.map((value, index) => value + (target[index] - value) * amount));
  };
  const relativeLuminance = toRgb(color).map(value => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  const luminance = relativeLuminance[0] * .2126 + relativeLuminance[1] * .7152 + relativeLuminance[2] * .0722;
  const background = mode === "dark" ? "#151922" : "#f5f7fb";
  const root = document.documentElement;

  root.dataset.theme = mode;
  root.dataset.specialTheme = "custom";
  root.style.setProperty("--ui-primary", color);
  root.style.setProperty("--ui-primary-light", blend(color, "#ffffff", .24));
  root.style.setProperty("--ui-primary-dark", blend(color, "#000000", .24));
  root.style.setProperty("--ui-primary-text", luminance > .45 ? blend(color, "#000000", .48) : "#ffffff");
  root.style.setProperty("--ui-primary-soft", blend(color, background, mode === "dark" ? .78 : .9));
  root.style.setProperty("--ui-primary-soft-strong", blend(color, background, mode === "dark" ? .68 : .84));
  root.style.setProperty("--ui-primary-border", blend(color, background, mode === "dark" ? .48 : .55));
  root.style.setProperty("--ui-primary-hover", blend(color, "#000000", .2));
  root.style.setProperty("--ui-primary-hover-dark", blend(color, "#000000", .34));
  window.orbyCustomTheme = { color, mode };
};

window.orbyClearCustomTheme = () => {
  propriedadesCorTemaPersonalizado.forEach(property => {
    document.documentElement.style.removeProperty(property);
  });
  delete document.documentElement.dataset.specialTheme;
};

try {
  const temaSalvo = localStorage.getItem(window.orbyThemeStorageKey);
  const temasValidos = ["light", "dark", "halloween", "natal", "orby-vannila", "custom"];
  const tema = temasValidos.includes(temaSalvo) ? temaSalvo : "light";
  if (tema === "custom") {
    const preferenciasSalvas = localStorage.getItem(window.orbyCustomThemeStorageKey);
    let preferencias = { color: "#174c32", mode: "light" };
    if (preferenciasSalvas) {
      try {
        const parsed = JSON.parse(preferenciasSalvas);
        if (
          parsed && typeof parsed === "object" &&
          typeof parsed.color === "string" && /^#[\da-f]{6}$/i.test(parsed.color) &&
          (parsed.mode === "light" || parsed.mode === "dark")
        ) {
          preferencias = {
            color: parsed.color,
            mode: parsed.mode
          };
        } else {
          console.warn("As preferências do tema personalizado são inválidas. Usando valores padrão.");
        }
      } catch (error) {
        console.warn("Não foi possível interpretar o tema personalizado salvo. Usando valores padrão.", error);
      }
    }
    window.orbyApplyCustomTheme(preferencias.color, preferencias.mode);
  } else {
    window.orbyClearCustomTheme();
    document.documentElement.dataset.theme = tema === "dark" || tema === "halloween" ? "dark" : "light";
  }
  if (["halloween", "natal", "orby-vannila"].includes(tema)) {
    document.documentElement.dataset.specialTheme = tema;
  }
} catch (error) {
  console.warn("Não foi possível carregar o tema salvo. Usando o tema claro.", error);
  document.documentElement.dataset.theme = "light";
  window.orbyClearCustomTheme();
}
