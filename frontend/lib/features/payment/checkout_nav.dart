import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_routes.dart';
import '../../data/models/payment_models.dart';

void pushCheckout(BuildContext context, Object? result) {
  final uuid = extractOrderUuid(result);
  if (uuid == null || !context.mounted) return;
  context.push(AppRoutes.checkoutPath(uuid));
}
