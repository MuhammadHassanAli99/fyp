import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'app_colors.dart';

enum AppThemeMode { light, dark, system }

abstract final class AppTheme {
  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    final base = ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: ColorScheme(
        brightness: brightness,
        primary: AppColors.gold,
        onPrimary: AppColors.charcoal,
        secondary: AppColors.goldMuted,
        onSecondary: AppColors.warmWhite,
        error: AppColors.error,
        onError: Colors.white,
        surface: isDark ? AppColors.charcoalLight : AppColors.warmWhite,
        onSurface: isDark ? AppColors.stone : AppColors.charcoal,
      ),
      scaffoldBackgroundColor:
          isDark ? AppColors.charcoal : AppColors.warmWhite,
      cardColor: isDark ? AppColors.charcoalSurface : Colors.white,
      dividerColor: isDark ? AppColors.stoneDark : AppColors.stone,
    );

    final displayFont = GoogleFonts.cormorantGaramondTextTheme(base.textTheme);
    final bodyFont = GoogleFonts.dmSansTextTheme(base.textTheme);

    return base.copyWith(
      textTheme: bodyFont.copyWith(
        displayLarge: displayFont.displayLarge?.copyWith(
          fontWeight: FontWeight.w600,
          letterSpacing: 1.2,
        ),
        displayMedium: displayFont.displayMedium?.copyWith(
          fontWeight: FontWeight.w600,
        ),
        headlineLarge: displayFont.headlineLarge?.copyWith(
          fontWeight: FontWeight.w600,
        ),
        headlineMedium: displayFont.headlineMedium?.copyWith(
          fontWeight: FontWeight.w600,
        ),
        titleLarge: bodyFont.titleLarge?.copyWith(fontWeight: FontWeight.w600),
        titleMedium: bodyFont.titleMedium?.copyWith(fontWeight: FontWeight.w500),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor:
            isDark ? AppColors.charcoalLight : AppColors.warmWhite,
        foregroundColor: isDark ? AppColors.stone : AppColors.charcoal,
        elevation: 0,
        centerTitle: false,
      ),
      cardTheme: CardThemeData(
        color: isDark ? AppColors.charcoalSurface : Colors.white,
        elevation: isDark ? 0 : 1,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? AppColors.charcoalSurface : Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(
            color: isDark ? AppColors.stoneDark : AppColors.stone,
          ),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(
            color: isDark ? AppColors.stoneDark : AppColors.stone,
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.gold, width: 1.5),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.gold,
          foregroundColor: AppColors.charcoal,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: GoogleFonts.dmSans(
            fontWeight: FontWeight.w600,
            fontSize: 15,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.gold,
          side: const BorderSide(color: AppColors.gold),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: AppColors.charcoalSurface,
        contentTextStyle: GoogleFonts.dmSans(color: AppColors.stone),
      ),
    );
  }
}
