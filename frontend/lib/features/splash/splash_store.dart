import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/di/service_locator.dart';
import '../../core/init/app_init_state.dart';
import '../../core/result/async_state.dart';

class SplashStore {
  final state = signal<AsyncState<bool>>(const AsyncIdle());
  final fadeIn = signal(false);

  Future<void> bootstrap() async {
    state.value = const AsyncLoading();
    await ServiceLocator.instance.appInitStore.run();
    final phase = ServiceLocator.instance.appInitStore.phase;
    if (phase == AppInitPhase.error) {
      state.value = AsyncError(
        ServiceLocator.instance.appInitStore.snapshot.value.errorMessage ??
            'Could not start',
      );
    } else {
      state.value = const AsyncData(true);
    }
    await Future<void>.delayed(const Duration(milliseconds: 400));
    fadeIn.value = true;
  }
}
