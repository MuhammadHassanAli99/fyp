import 'package:flutter/material.dart';

import '../maps/discovery_map_screen.dart';

class PropertyMapScreen extends StatelessWidget {
  const PropertyMapScreen({super.key});

  @override
  Widget build(BuildContext context) => const DiscoveryMapScreen(marketplace: 'property');
}
