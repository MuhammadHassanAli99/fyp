import '../../core/network/api_client.dart';
import '../models/marketplace_model.dart';
import '../models/user_model.dart';

class BootstrapApi {
  BootstrapApi(this._client);
  final ApiClient _client;

  Future<BootstrapData> fetch() => _client.get(
        '/bootstrap',
        parser: (d) => BootstrapData.fromJson(d as Map<String, dynamic>),
      );
}

class BootstrapData {
  const BootstrapData({
    this.marketplaces = const [],
    this.featureFlags = const {},
    this.compatibility,
  });

  factory BootstrapData.fromJson(Map<String, dynamic> json) => BootstrapData(
        marketplaces: (json['marketplaces'] as List? ?? [])
            .map((e) => MarketplaceModel.fromJson(e as Map<String, dynamic>))
            .toList(),
        featureFlags: Map<String, dynamic>.from(
          json['featureFlags'] as Map? ?? json['features'] as Map? ?? {},
        ),
        compatibility: CompatibilityInfo.fromJson(json),
      );

  final List<MarketplaceModel> marketplaces;
  final Map<String, dynamic> featureFlags;
  final CompatibilityInfo? compatibility;
}
