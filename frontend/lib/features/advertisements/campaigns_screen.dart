import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../features/payment/checkout_nav.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'ads_store.dart';

class CampaignsScreen extends StatefulWidget {
  const CampaignsScreen({super.key});

  @override
  State<CampaignsScreen> createState() => _CampaignsScreenState();
}

class _CampaignsScreenState extends State<CampaignsScreen> {
  late final AdsStore _store;
  final _name = TextEditingController();
  final _headline = TextEditingController();
  final _budget = TextEditingController(text: '50');
  String? _imageUrl;

  @override
  void initState() {
    super.initState();
    _store = ServiceLocator.instance.adsStore;
    _store.load();
  }

  @override
  void dispose() {
    _name.dispose();
    _headline.dispose();
    _budget.dispose();
    super.dispose();
  }

  Future<void> _pickCreative() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 85,
      maxWidth: 1600,
    );
    if (picked == null) return;
    try {
      final uploaded = await ServiceLocator.instance.mediaUploadService.uploadFile(
        file: File(picked.path),
        purpose: 'ad_creative',
      );
      if (!mounted) return;
      setState(() => _imageUrl = uploaded.fileUrl);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _create() async {
    final name = _name.text.trim();
    final headline = _headline.text.trim();
    if (name.length < 2) return;
    if (headline.length < 3) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Add a headline before creating the campaign.')),
      );
      return;
    }
    try {
      final created = await ServiceLocator.instance.adsApi.createCampaign({
        'name': name,
        'objective': 'traffic',
        'pricingModel': 'cpc',
        'bidAmount': 0.35,
        'placementCodes': ['search_native_3', 'home_banner_top'],
      });
      final uuid = created['uuid']?.toString();
      if (uuid != null) {
        await ServiceLocator.instance.adsApi.addCreative(uuid, {
          'name': headline,
          'format': 'native',
          'headline': headline,
          'imageUrl': _imageUrl,
          'ctaLabel': 'View',
        });
      }
      _name.clear();
      _headline.clear();
      setState(() => _imageUrl = null);
      await _store.load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _fund(String uuid) async {
    final amount = double.tryParse(_budget.text) ?? 50;
    try {
      final result = await ServiceLocator.instance.adsApi.fund(
        uuid,
        amount: amount,
        gatewayCode: 'manual',
      );
      if (!mounted) return;
      pushCheckout(context, result);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _submit(String uuid) async {
    try {
      await ServiceLocator.instance.adsApi.submit(uuid);
      await _store.load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Advertise',
      body: SignalBuilder(
        builder: (context) {
          final campaigns = _store.campaigns.value.dataOrNull ?? const [];
          final advertiser = _store.advertiser.value.dataOrNull;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (advertiser != null)
                Text(
                  'Balance ${advertiser['balance'] ?? 0} ${advertiser['currency'] ?? ''}',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              const SizedBox(height: 12),
              TextField(
                controller: _name,
                decoration: const InputDecoration(labelText: 'Campaign name'),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _headline,
                decoration: const InputDecoration(labelText: 'Ad headline'),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _pickCreative,
                icon: const Icon(Icons.image_outlined),
                label: Text(_imageUrl == null ? 'Add creative image' : 'Creative image attached'),
              ),
              const SizedBox(height: 8),
              FilledButton(onPressed: _create, child: const Text('Create campaign')),
              const Divider(height: 32),
              TextField(
                controller: _budget,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Fund amount'),
              ),
              const SizedBox(height: 12),
              if (campaigns.isEmpty)
                const Text('No campaigns yet. Paid placements are labeled Sponsored or Advertisement.')
              else
                for (final campaign in campaigns)
                  Card(
                    color: AppColors.charcoalSurface,
                    child: ListTile(
                      title: Text(campaign.name),
                      subtitle: Text(
                        '${campaign.status} · ${campaign.spentAmount.toStringAsFixed(2)} / ${campaign.totalBudget ?? '∞'} ${campaign.currency}',
                      ),
                      trailing: Wrap(
                        spacing: 8,
                        children: [
                          TextButton(
                            onPressed: () => _fund(campaign.uuid),
                            child: const Text('Fund'),
                          ),
                          TextButton(
                            onPressed: () => _submit(campaign.uuid),
                            child: const Text('Submit'),
                          ),
                        ],
                      ),
                    ),
                  ),
            ],
          );
        },
      ),
    );
  }
}
