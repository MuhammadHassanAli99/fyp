import 'dart:io';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'data/review_models.dart';
import 'reviews_store.dart';

class WriteReviewScreen extends StatefulWidget {
  const WriteReviewScreen({super.key, required this.listingId});

  final String listingId;

  @override
  State<WriteReviewScreen> createState() => _WriteReviewScreenState();
}

class _WriteReviewScreenState extends State<WriteReviewScreen> {
  late final ReviewsStore _store;
  final _title = TextEditingController();
  final _body = TextEditingController();
  double _rating = 5;
  String? _error;
  int? _numericListingId;
  final _media = <Map<String, dynamic>>[];
  final _criteriaRatings = <String, double>{};
  List<ReviewCriterion> _criteria = const [];

  @override
  void initState() {
    super.initState();
    _store = ReviewsStore(ServiceLocator.instance.reviewsApi);
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    final parsed = int.tryParse(widget.listingId);
    if (parsed != null) {
      _numericListingId = parsed;
    } else {
      final result = await ServiceLocator.instance.listingsRepository.getById(widget.listingId);
      _numericListingId = result.dataOrNull?.numericId;
    }
    if (!mounted) return;
    try {
      _criteria = await _store.criteria(appliesTo: 'listing');
      for (final item in _criteria) {
        _criteriaRatings.putIfAbsent(item.code, () => _rating);
      }
    } catch (_) {}
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final listingId = _numericListingId;
    if (listingId == null) {
      setState(() => _error = 'This listing cannot be reviewed yet.');
      return;
    }
    setState(() => _error = null);
    final result = await _store.submit(
      listingId: listingId,
      rating: _rating,
      title: _title.text.trim().isEmpty ? null : _title.text.trim(),
      body: _body.text.trim().isEmpty ? null : _body.text.trim(),
      criteria: [
        for (final item in _criteria)
          if (_criteriaRatings[item.code] != null)
            {'code': item.code, 'rating': _criteriaRatings[item.code]},
      ],
      media: _media,
    );
    if (!mounted) return;
    result.when(
      success: (_) => context.pop(),
      failure: (message, _) => setState(() => _error = message),
    );
  }

  Future<void> _attach({required bool video}) async {
    if (_media.length >= 8) {
      setState(() => _error = 'A review can include at most 8 photos or videos.');
      return;
    }
    final picker = ImagePicker();
    final picked = video
        ? await picker.pickVideo(source: ImageSource.gallery, maxDuration: const Duration(minutes: 2))
        : await picker.pickImage(source: ImageSource.gallery, imageQuality: 85, maxWidth: 1920);
    if (picked == null) return;
    try {
      final uploaded = await ServiceLocator.instance.mediaUploadService.uploadFile(
        file: File(picked.path),
        purpose: 'review_media',
        mimeType: video ? 'video/mp4' : null,
      );
      if (!mounted) return;
      _media.add({
        'url': uploaded.fileUrl,
        'objectKey': uploaded.storagePath,
        'kind': uploaded.mimeType.startsWith('video/') || video ? 'video' : 'image',
        'mimeType': uploaded.mimeType,
      });
      setState(() {});
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Write a review',
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('Overall rating'),
          Slider(
            value: _rating,
            min: 1,
            max: 5,
            divisions: 4,
            label: _rating.toStringAsFixed(0),
            onChanged: (value) => setState(() => _rating = value),
          ),
          for (final criterion in _criteria) ...[
            const SizedBox(height: 8),
            Text(criterion.label),
            Slider(
              value: _criteriaRatings[criterion.code] ?? 5,
              min: 1,
              max: 5,
              divisions: 4,
              label: (_criteriaRatings[criterion.code] ?? 5).toStringAsFixed(0),
              onChanged: (value) => setState(() => _criteriaRatings[criterion.code] = value),
            ),
          ],
          TextField(
            controller: _title,
            decoration: const InputDecoration(labelText: 'Title'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _body,
            maxLines: 5,
            decoration: const InputDecoration(labelText: 'Your experience'),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed: () => _attach(video: false),
                icon: const Icon(Icons.photo_outlined),
                label: const Text('Add photo'),
              ),
              OutlinedButton.icon(
                onPressed: () => _attach(video: true),
                icon: const Icon(Icons.videocam_outlined),
                label: const Text('Add video'),
              ),
            ],
          ),
          if (_media.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text('${_media.length} attached (max 8)'),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(_error!, style: const TextStyle(color: AppColors.error)),
            ),
          const SizedBox(height: 20),
          SignalBuilder(
            builder: (context) {
              return FilledButton(
                onPressed: _store.busy.value ? null : _submit,
                child: Text(_store.busy.value ? 'Submitting…' : 'Publish review'),
              );
            },
          ),
        ],
      ),
    );
  }
}
