/**
 * Brand tokens shared with the rest of Deverout's Solomon work (website
 * styles.css, the licensing-agreement artifact): ink / parchment / brass.
 * Kept minimal on purpose -- custom fonts (EB Garamond / Hanken Grotesk)
 * are a later refinement, not needed for this first screen.
 */
export const theme = {
  colors: {
    ink: "#0d1a2b",
    inkSoft: "#4a5a70",
    parchment: "#f5efe3",
    parchmentCard: "#efe7d6",
    brass: "#8a6a38",
    brassBright: "#a5793f",
    muted: "#6f6b54",
    line: "#dfd6bf",
    good: "#3f5d3f",
    goodBg: "#e4ead9",
  },
  spacing: (n: number) => n * 4,
};
