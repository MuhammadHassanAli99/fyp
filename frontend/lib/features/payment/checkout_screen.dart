import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;
import 'package:url_launcher/url_launcher.dart';

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/app_routes.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../data/models/payment_models.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'checkout_store.dart';

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key, required this.orderUuid});

  final String orderUuid;

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  late final CheckoutStore _store;

  @override
  void initState() {
    super.initState();
    final sl = ServiceLocator.instance;
    _store = CheckoutStore(sl.paymentsRepository, widget.orderUuid, sl.realtimeClient);
    _store.listen();
    _store.startPolling();
    _store.load();
  }

  @override
  void dispose() {
    _store.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      title: l10n.checkoutTitle,
      showSellFab: false,
      body: SignalBuilder(
        builder: (context) {
          final state = _store.checkout.value;
          if (state.isLoading && state.dataOrNull == null) {
            return const Center(child: CircularProgressIndicator());
          }
          if (state.hasError && state.dataOrNull == null) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(state.errorMessage ?? l10n.checkoutLoadError),
                    const SizedBox(height: 12),
                    FilledButton(onPressed: _store.load, child: Text(l10n.retry)),
                  ],
                ),
              ),
            );
          }
          final data = state.dataOrNull;
          if (data == null) {
            return Center(child: Text(l10n.checkoutLoadError));
          }
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                l10n.checkoutAuthoritativeHint,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 16),
              _StatusCard(checkout: data),
              const SizedBox(height: 12),
              _AmountCard(checkout: data),
              if (data.intent?.instructions != null && data.intent!.instructions!.isNotEmpty) ...[
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(data.intent!.instructions!),
                  ),
                ),
              ],
              if (data.bankTransfer != null) ...[
                const SizedBox(height: 12),
                _BankCard(info: data.bankTransfer!),
              ],
              if (data.invoice != null) ...[
                const SizedBox(height: 12),
                ListTile(
                  leading: const Icon(Icons.receipt_long),
                  title: Text(l10n.checkoutInvoice),
                  subtitle: Text(data.invoice!.invoiceNumber),
                ),
              ],
              if (_store.message.value != null) ...[
                const SizedBox(height: 12),
                Text(_store.message.value!, style: const TextStyle(color: AppColors.gold)),
              ],
              const SizedBox(height: 20),
              if (data.isOpen && data.intent?.redirectUrl != null)
                FilledButton(
                  onPressed: () => _openProvider(data.intent!.redirectUrl!),
                  child: Text(l10n.checkoutContinueProvider),
                ),
              if (data.isOpen && data.bankTransfer != null) ...[
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: _store.busy.value ? null : _uploadProof,
                  child: Text(l10n.checkoutUploadProof),
                ),
              ],
              // Debug builds only. This calls the simulate endpoint, which the
              // API refuses in production, so including `provider == 'manual'`
              // here rendered a button in release builds that could only ever
              // return an error. Real manual settlement is a staff action:
              // buyers upload proof above and support confirms the transfer.
              if (data.isOpen && kDebugMode) ...[
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: _store.busy.value ? null : () => _store.completeTestPayment(),
                  child: Text(l10n.checkoutCompleteTest),
                ),
              ],
              if (data.isPaid) ...[
                const SizedBox(height: 8),
                FilledButton(
                  onPressed: () {
                    if (data.order.kind == 'subscription') {
                      context.go(AppRoutes.subscription);
                    } else {
                      context.go(AppRoutes.home);
                    }
                  },
                  child: Text(l10n.checkoutPaidContinue),
                ),
              ],
              const SizedBox(height: 16),
              TextButton.icon(
                onPressed: () => context.push(
                  AppRoutes.supportWith(
                    SupportContextQuery(
                      category: 'payments',
                      entityType: 'order',
                      orderUuid: widget.orderUuid,
                    ),
                  ),
                ),
                icon: const Icon(Icons.support_agent_outlined),
                label: const Text('Need help with this payment?'),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _openProvider(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  Future<void> _uploadProof() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (picked == null) return;
    final bytes = await picked.readAsBytes();
    final mime = picked.mimeType ?? 'image/jpeg';
    final uploaded = await ServiceLocator.instance.mediaUploadService.uploadBytes(
      bytes: bytes,
      purpose: 'document',
      mimeType: mime,
      filename: picked.name,
    );
    await _store.submitProof(storagePath: uploaded.storagePath, mimeType: mime);
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.checkout});
  final PaymentCheckout checkout;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final color = checkout.isPaid
        ? AppColors.success
        : checkout.isFailed
            ? AppColors.error
            : AppColors.gold;
    final label = checkout.isPaid
        ? l10n.checkoutPaid
        : checkout.isFailed
            ? l10n.checkoutFailed
            : l10n.checkoutPending;
    return Card(
      child: ListTile(
        leading: Icon(Icons.payments, color: color),
        title: Text(label),
        subtitle: Text('${checkout.order.orderNumber} · ${checkout.order.status}'),
      ),
    );
  }
}

class _AmountCard extends StatelessWidget {
  const _AmountCard({required this.checkout});
  final PaymentCheckout checkout;

  @override
  Widget build(BuildContext context) {
    final order = checkout.order;
    final intent = checkout.intent;
    final display = intent?.displayAmount ?? order.totalAmount;
    final currency = intent?.displayCurrency ?? order.currency;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${display.toStringAsFixed(2)} $currency',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            if (intent != null && intent.chargeCurrency != currency)
              Text(
                context.l10n.checkoutChargedAs(
                  intent.chargeAmount.toStringAsFixed(2),
                  intent.chargeCurrency,
                ),
              ),
            if (order.taxAmount != null && order.taxAmount! > 0)
              Text('${context.l10n.checkoutTax}: ${order.taxAmount!.toStringAsFixed(2)} ${order.currency}'),
            Text('${context.l10n.checkoutMethod}: ${intent?.method ?? checkout.payment?.method ?? '—'}'),
            Text('${context.l10n.checkoutProvider}: ${intent?.provider ?? checkout.payment?.provider ?? '—'}'),
          ],
        ),
      ),
    );
  }
}

class _BankCard extends StatelessWidget {
  const _BankCard({required this.info});
  final BankTransferInfo info;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.checkoutBankTransfer, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text('${l10n.checkoutBankReference}: ${info.referenceCode}'),
            Text('${info.bankName} · ${info.accountName}'),
            Text(info.accountNumberMasked),
            if (info.ibanMasked != null) Text(info.ibanMasked!),
            const SizedBox(height: 8),
            Text(l10n.checkoutProofNotPaid),
          ],
        ),
      ),
    );
  }
}
