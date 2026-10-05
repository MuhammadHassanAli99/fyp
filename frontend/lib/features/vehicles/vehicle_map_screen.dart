import 'package:flutter/material.dart';

import '../maps/discovery_map_screen.dart';

class VehicleMapScreen extends StatelessWidget {
  const VehicleMapScreen({super.key});

  @override
  Widget build(BuildContext context) => const DiscoveryMapScreen(marketplace: 'vehicles');
}
