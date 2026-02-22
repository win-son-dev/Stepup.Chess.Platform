const AVATAR_COLORS = [
  0xFF5C6BC0, // indigo
  0xFF26A69A, // teal
  0xFFEF5350, // red
  0xFF66BB6A, // green
  0xFFFFA726, // orange
  0xFFAB47BC, // purple
  0xFF29B6F6, // light blue
  0xFFEC407A, // pink
];

/** Returns a random ARGB int for the avatar background (matches Dart's int color format). */
export function randomAvatarColor(): number {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}
