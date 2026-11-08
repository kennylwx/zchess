export interface OpeningLine {
  name: string;
  moves: string[];
}

export interface OpeningKind {
  name: string;
  lines: OpeningLine[];
}

/** A small, selectable opening library. Moves are SAN and start from the initial position. */
export const OPENING_KINDS: OpeningKind[] = [
  { name: 'Open Games · 1.e4 e5', lines: [
    { name: 'Italian Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'] },
    { name: 'Ruy Lopez', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6'] },
    { name: 'Scotch Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4'] },
    { name: 'Petrov Defense', moves: ['e4', 'e5', 'Nf3', 'Nf6'] },
  ] },
  { name: 'Sicilian Defense · 1.e4 c5', lines: [
    { name: 'Open Sicilian', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'] },
    { name: 'Dragon Variation', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6'] },
    { name: 'Najdorf Variation', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'] },
    { name: 'Sicilian, Closed', moves: ['e4', 'c5', 'Nc3', 'Nc6', 'g3'] },
  ] },
  { name: 'French Defense · 1.e4 e6', lines: [
    { name: 'Advance Variation', moves: ['e4', 'e6', 'd4', 'd5', 'e5'] },
    { name: 'Tarrasch Variation', moves: ['e4', 'e6', 'd4', 'd5', 'Nd2'] },
    { name: 'Exchange Variation', moves: ['e4', 'e6', 'd4', 'd5', 'exd5', 'exd5'] },
  ] },
  { name: 'Caro-Kann Defense · 1.e4 c6', lines: [
    { name: 'Classical Variation', moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5'] },
    { name: 'Advance Variation', moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5'] },
    { name: 'Exchange Variation', moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5'] },
  ] },
  { name: 'Queen’s Pawn & Indian Defenses · 1.d4', lines: [
    { name: 'Queen’s Gambit', moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6'] },
    { name: 'King’s Indian Defense', moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6'] },
    { name: 'Nimzo-Indian Defense', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
    { name: 'Slav Defense', moves: ['d4', 'd5', 'c4', 'c6'] },
  ] },
  { name: 'Flank Openings · 1.c4 / 1.Nf3 / 1.f4', lines: [
    { name: 'English Opening', moves: ['c4', 'e5', 'Nc3', 'Nf6', 'g3'] },
    { name: 'Réti Opening', moves: ['Nf3', 'd5', 'c4'] },
    { name: 'Bird’s Opening', moves: ['f4', 'd5', 'Nf3', 'Nf6'] },
  ] },
  { name: 'Gambits', lines: [
    { name: 'King’s Gambit', moves: ['e4', 'e5', 'f4', 'exf4'] },
    { name: 'Danish Gambit', moves: ['e4', 'e5', 'd4', 'exd4', 'c3', 'dxc3', 'Bc4'] },
    { name: 'Smith-Morra Gambit', moves: ['e4', 'c5', 'd4', 'cxd4', 'c3'] },
  ] },
];
