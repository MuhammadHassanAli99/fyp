import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart';

Future<bool> _request(Permission permission) async {
  if (kIsWeb) return true;
  try {
    final status = await permission.request();
    return status.isGranted || status.isLimited;
  } catch (_) {
    return true;
  }
}

Future<bool> ensureMicrophonePermission() => _request(Permission.microphone);

Future<bool> ensureCameraAndMicrophone() async {
  final mic = await ensureMicrophonePermission();
  if (!mic) return false;
  if (kIsWeb) return true;
  try {
    final cam = await Permission.camera.request();
    return cam.isGranted || cam.isLimited;
  } catch (_) {
    return true;
  }
}

Future<bool> ensureLocationPermission() async {
  if (kIsWeb) return true;
  try {
    final whenInUse = await Permission.locationWhenInUse.request();
    if (whenInUse.isGranted || whenInUse.isLimited) return true;
    final coarse = await Permission.location.request();
    return coarse.isGranted || coarse.isLimited;
  } catch (_) {
    return true;
  }
}
