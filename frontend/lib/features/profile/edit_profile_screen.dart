import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'profile_store.dart';

class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  late final ProfileStore _store;
  final _name = TextEditingController();
  final _username = TextEditingController();
  final _bio = TextEditingController();
  String? _usernameHint;
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    _store = ServiceLocator.instance.profileStore;
    final me = _store.me.value.dataOrNull;
    final profile = me?['profile'] is Map
        ? Map<String, dynamic>.from(me!['profile'] as Map)
        : const <String, dynamic>{};
    _name.text = profile['displayName'] as String? ?? '';
    _username.text = me?['username'] as String? ?? '';
    _bio.text = profile['bio'] as String? ?? '';
    if (me == null) _store.loadMine();
  }

  @override
  void dispose() {
    _name.dispose();
    _username.dispose();
    _bio.dispose();
    super.dispose();
  }

  Future<void> _pickAvatar() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      maxWidth: 2048,
      maxHeight: 2048,
      imageQuality: 88,
    );
    if (picked == null) return;
    setState(() => _uploading = true);
    final bytes = await picked.readAsBytes();
    final mime = picked.mimeType ?? 'image/jpeg';
    final result = await ServiceLocator.instance.profileRepository.uploadAvatar(
      bytes: bytes,
      mimeType: mime,
      filename: picked.name,
    );
    setState(() => _uploading = false);
    result.when(
      success: (_) => _store.loadMine(),
      failure: (message, _) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
        }
      },
    );
  }

  Future<void> _save() async {
    final saved = await _store.saveProfile({
      'displayName': _name.text.trim(),
      'bio': _bio.text.trim(),
    });
    if (!saved.isSuccess) return;
    final nextUsername = _username.text.trim();
    final current = _store.me.value.dataOrNull?['username'] as String? ?? '';
    if (nextUsername.isNotEmpty && nextUsername.toLowerCase() != current.toLowerCase()) {
      final changed = await _store.saveUsername(nextUsername);
      if (!changed.isSuccess && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_store.error.value ?? 'Could not change username')),
        );
        return;
      }
    }
    if (mounted) context.pop();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      title: l10n.editProfile,
      body: SignalBuilder(
        builder: (context) {
          final me = _store.me.value.dataOrNull;
          final profile = me?['profile'] is Map
              ? Map<String, dynamic>.from(me!['profile'] as Map)
              : const <String, dynamic>{};
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Center(
                child: Stack(
                  children: [
                    CircleAvatar(
                      radius: 48,
                      backgroundColor: AppColors.charcoalSurface,
                      backgroundImage: (profile['avatarUrl'] as String?) != null
                          ? NetworkImage(profile['avatarUrl'] as String)
                          : null,
                      child: (profile['avatarUrl'] as String?) == null
                          ? const Icon(Icons.person, color: AppColors.gold, size: 40)
                          : null,
                    ),
                    Positioned(
                      right: 0,
                      bottom: 0,
                      child: IconButton.filled(
                        onPressed: _uploading ? null : _pickAvatar,
                        icon: _uploading
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.camera_alt, size: 18),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              TextField(
                controller: _name,
                decoration: InputDecoration(labelText: l10n.displayName),
                textCapitalization: TextCapitalization.words,
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _username,
                decoration: InputDecoration(
                  labelText: l10n.username,
                  prefixText: '@',
                  helperText: _usernameHint,
                ),
                onChanged: (value) async {
                  if (value.trim().length < 3) return;
                  final result = await ServiceLocator.instance.profileRepository
                      .usernameAvailable(value.trim());
                  if (!mounted) return;
                  setState(() {
                    _usernameHint = result.when(
                      success: (check) => check.available
                          ? 'Available'
                          : (check.issues.isEmpty
                              ? 'Unavailable'
                              : check.issues.first),
                      failure: (message, _) => message,
                    );
                  });
                },
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _bio,
                maxLength: 1000,
                maxLines: 5,
                decoration: InputDecoration(labelText: l10n.bio),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _store.saving.value ? null : _save,
                child: Text(l10n.save),
              ),
            ],
          );
        },
      ),
    );
  }
}
