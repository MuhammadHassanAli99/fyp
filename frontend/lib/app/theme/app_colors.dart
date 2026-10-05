import 'package:flutter/material.dart';

abstract final class AppColors {
  static const charcoal = Color(0xFF0F1419);
  static const charcoalLight = Color(0xFF1A2129);
  static const charcoalSurface = Color(0xFF232B35);
  static const gold = Color(0xFFC4A35A);
  static const goldLight = Color(0xFFD4BC7A);
  static const goldMuted = Color(0xFF8A7340);
  static const stone = Color(0xFFE8E4DC);
  static const stoneDark = Color(0xFF3D4550);
  static const warmWhite = Color(0xFFF7F5F0);
  static const error = Color(0xFFCF6679);
  static const success = Color(0xFF6BAA75);

  static const goldGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [goldLight, gold, goldMuted],
  );
}
