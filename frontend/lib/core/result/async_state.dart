/// App-owned async state. Kept separate from `package:signals`'s AsyncState
/// so feature stores never collide on naming.
sealed class AsyncState<T> {
  const AsyncState();

  bool get isLoading => this is AsyncLoading<T>;
  bool get hasData => this is AsyncData<T>;
  bool get hasError => this is AsyncError<T>;
  bool get isIdle => this is AsyncIdle<T>;

  T? get dataOrNull => switch (this) {
        AsyncData<T>(:final data) => data,
        AsyncLoading<T>(:final previous) => previous,
        AsyncError<T>(:final previous) => previous,
        AsyncIdle<T>() => null,
      };

  String? get errorMessage => switch (this) {
        AsyncError<T>(:final message) => message,
        _ => null,
      };
}

final class AsyncIdle<T> extends AsyncState<T> {
  const AsyncIdle();
}

final class AsyncLoading<T> extends AsyncState<T> {
  const AsyncLoading({this.previous});
  final T? previous;
}

final class AsyncData<T> extends AsyncState<T> {
  const AsyncData(this.data);
  final T data;
}

final class AsyncError<T> extends AsyncState<T> {
  const AsyncError(this.message, {this.previous, this.code});
  final String message;
  final T? previous;
  final String? code;
}
