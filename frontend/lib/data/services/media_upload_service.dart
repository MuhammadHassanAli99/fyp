import 'dart:io';
import 'dart:typed_data';

import 'package:mime/mime.dart';
import 'package:path/path.dart' as p;

import '../models/chat_models.dart';
import '../remote/chat_api.dart';

class MediaUploadService {
  MediaUploadService(this._uploads);
  final UploadsApi _uploads;

  Future<SignedUpload> uploadFile({
    required File file,
    required String purpose,
    String? mimeType,
  }) async {
    final bytes = await file.readAsBytes();
    return uploadBytes(
      bytes: bytes,
      purpose: purpose,
      mimeType: mimeType ??
          lookupMimeType(file.path) ??
          'application/octet-stream',
      filename: p.basename(file.path),
    );
  }

  Future<SignedUpload> uploadBytes({
    required Uint8List bytes,
    required String purpose,
    required String mimeType,
    String? filename,
  }) async {
    final signed = await _uploads.sign(
      purpose: purpose,
      mimeType: mimeType,
      sizeBytes: bytes.length,
      filename: filename,
    );
    await _uploads.putBytes(
      uploadUrl: signed.uploadUrl,
      bytes: bytes,
      mimeType: mimeType,
    );
    return signed;
  }
}
