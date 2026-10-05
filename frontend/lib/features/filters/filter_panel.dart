import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../data/models/filter_models.dart';
import '../../shared/extensions/context_extensions.dart';
import 'filter_state.dart';

Future<FilterState?> showFilterPanel(
  BuildContext context, {
  required FilterState initial,
  String? marketplace,
}) {
  final panel = FilterPanel(initial: initial, marketplace: marketplace);
  if (context.isDesktop) {
    return showGeneralDialog<FilterState>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Filters',
      pageBuilder: (ctx, _, _) => Align(
        alignment: Alignment.centerRight,
        child: Material(
          child: SizedBox(
            width: 420,
            height: MediaQuery.sizeOf(ctx).height,
            child: panel,
          ),
        ),
      ),
    );
  }
  return showModalBottomSheet<FilterState>(
    context: context,
    isScrollControlled: true,
    builder: (_) => SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.88,
      child: panel,
    ),
  );
}

class FilterPanel extends StatefulWidget {
  const FilterPanel({super.key, required this.initial, this.marketplace});

  final FilterState initial;
  final String? marketplace;

  @override
  State<FilterPanel> createState() => _FilterPanelState();
}

class _FilterPanelState extends State<FilterPanel> {
  late final FilterState _state = widget.initial.copy();
  List<FilterDefinition> _definitions = const [];
  final Map<String, List<FilterLookupItem>> _lookups = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final marketplace = widget.marketplace ?? _state.marketplace;
    final result = await ServiceLocator.instance.filtersRepository.definitions(
      marketplace: marketplace,
    );
    if (!mounted) return;
    result.when(
      success: (items) => setState(() {
        _definitions = items;
        _loading = false;
      }),
      failure: (_, _) => setState(() => _loading = false),
    );
  }

  List<FilterDefinition> get _visible {
    return _definitions.where((item) {
      if (item.visibility == 'hidden') return false;
      if (item.dependsOn == null || item.dependsOn!.isEmpty) return true;
      final parent = _state.valueOf(item.dependsOn!);
      return parent != null && parent != false && parent != '';
    }).toList();
  }

  Future<void> _ensureLookup(FilterDefinition def) async {
    if (_lookups.containsKey(def.key)) return;
    if (def.dataSource == null && def.allowedValues.isNotEmpty) return;
    final parentKey = def.dependsOn;
    final parentValue = parentKey == null ? null : _state.valueOf(parentKey)?.toString();
    final result = await ServiceLocator.instance.filtersRepository.lookups(
      key: def.key,
      marketplace: _state.marketplace ?? widget.marketplace,
      parentKey: parentKey,
      parentValue: parentValue,
      countryId: ServiceLocator.instance.settingsRepository.countryId,
    );
    if (!mounted) return;
    result.when(
      success: (items) => setState(() => _lookups[def.key] = items),
      failure: (_, _) {},
    );
  }

  void _setValue(FilterDefinition def, dynamic value) {
    _state.setValue(def.key, value);
    for (final child in _definitions.where((item) => item.dependsOn == def.key)) {
      _state.remove(child.key);
      _lookups.remove(child.key);
    }
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottom),
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 8, 8),
              child: Row(
                children: [
                  const Expanded(
                    child: Text('Filters', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                  ),
                  TextButton(
                    onPressed: () => setState(_state.clear),
                    child: const Text('Reset'),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
            if (_loading) const LinearProgressIndicator(),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                children: [
                  for (final def in _visible) ...[
                    if (def.type != 'boolean')
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8, top: 12),
                        child: Text(
                          def.label,
                          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                                color: AppColors.gold,
                                fontWeight: FontWeight.w700,
                              ),
                        ),
                      ),
                    _FilterControl(
                      definition: def,
                      state: _state,
                      lookups: _lookups[def.key] ?? const [],
                      onChanged: (value) => _setValue(def, value),
                      onNeedLookup: () => _ensureLookup(def),
                    ),
                  ],
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () {
                        _state.clear();
                        Navigator.pop(context, _state);
                      },
                      child: const Text('Clear all'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      onPressed: () => Navigator.pop(context, _state),
                      child: Text('Apply (${_state.activeCount})'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class FilterChipsBar extends StatelessWidget {
  const FilterChipsBar({
    super.key,
    required this.state,
    required this.definitions,
    required this.onChanged,
    this.onSave,
  });

  final FilterState state;
  final List<FilterDefinition> definitions;
  final VoidCallback onChanged;
  final VoidCallback? onSave;

  String _label(String key, dynamic value) {
    final def = definitions.where((d) => d.key == key).firstOrNull;
    final name = def?.label ?? key;
    if (value == true) return name;
    if (value is Map) {
      final min = value['min'];
      final max = value['max'];
      if (min != null && max != null) return '$name $min–$max';
      if (max != null) return '$name ≤ $max';
      if (min != null) return '$name ≥ $min';
      if (value['label'] != null) return '${value['label']}';
    }
    if (value is List) return '$name (${value.length})';
    return '$name: $value';
  }

  @override
  Widget build(BuildContext context) {
    final chips = <Widget>[];
    if (state.operation != null) {
      chips.add(_chip('operation', state.operation!, () {
        state.operation = null;
        onChanged();
      }));
    }
    for (final entry in state.values.entries) {
      chips.add(_chip(entry.key, _label(entry.key, entry.value), () {
        state.remove(entry.key);
        onChanged();
      }));
    }
    if (chips.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      child: Row(
        children: [
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(children: chips),
            ),
          ),
          TextButton(
            onPressed: () {
              state.clear();
              onChanged();
            },
            child: const Text('Clear'),
          ),
          if (onSave != null) TextButton(onPressed: onSave, child: const Text('Save')),
        ],
      ),
    );
  }

  Widget _chip(String key, String label, VoidCallback onDeleted) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: InputChip(
        label: Text(label),
        onDeleted: onDeleted,
      ),
    );
  }
}

class _FilterControl extends StatelessWidget {
  const _FilterControl({
    required this.definition,
    required this.state,
    required this.lookups,
    required this.onChanged,
    required this.onNeedLookup,
  });

  final FilterDefinition definition;
  final FilterState state;
  final List<FilterLookupItem> lookups;
  final ValueChanged<dynamic> onChanged;
  final VoidCallback onNeedLookup;

  @override
  Widget build(BuildContext context) {
    switch (definition.type) {
      case 'boolean':
        return SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(definition.label),
          value: state.valueOf(definition.key) == true,
          onChanged: onChanged,
        );
      case 'single_select':
      case 'enum':
        final options = definition.allowedValues.isNotEmpty
            ? definition.allowedValues
            : lookups.map((e) => FilterOption(value: e.value, label: e.label)).toList();
        if (options.isEmpty) {
          return _LookupTrigger(onNeedLookup: onNeedLookup, child: const LinearProgressIndicator());
        }
        return Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final option in options)
              ChoiceChip(
                label: Text(option.label),
                selected: '${state.valueOf(definition.key)}' == option.value,
                onSelected: (s) => onChanged(s ? option.value : null),
              ),
          ],
        );
      case 'multi_select':
        final selected = state.valueOf(definition.key);
        final selectedList = selected is List ? selected.map((e) => e.toString()).toSet() : <String>{};
        if (selected is String) selectedList.add(selected);
        return Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final option in definition.allowedValues)
              FilterChip(
                label: Text(option.label),
                selected: selectedList.contains(option.value),
                onSelected: (s) {
                  final next = {...selectedList};
                  if (s) {
                    next.add(option.value);
                  } else {
                    next.remove(option.value);
                  }
                  onChanged(next.toList());
                },
              ),
          ],
        );
      case 'rating':
        final current = (state.valueOf(definition.key) as num?)?.toDouble();
        return Wrap(
          spacing: 8,
          children: [
            for (final n in [3.0, 4.0, 4.5])
              ChoiceChip(
                label: Text('$n+'),
                selected: current == n,
                onSelected: (s) => onChanged(s ? n : null),
              ),
          ],
        );
      case 'number':
        return _NumberField(
          value: (state.valueOf(definition.key) as num?)?.toDouble(),
          onChanged: onChanged,
        );
      case 'range':
      case 'currency_range':
      case 'year_range':
        final raw = state.valueOf(definition.key);
        final map = raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
        return Row(
          children: [
            Expanded(
              child: _NumberField(
                label: 'Min',
                value: (map['min'] as num?)?.toDouble(),
                onChanged: (v) {
                  map['min'] = v;
                  onChanged(map);
                },
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _NumberField(
                label: 'Max',
                value: (map['max'] as num?)?.toDouble(),
                onChanged: (v) {
                  map['max'] = v;
                  onChanged(map);
                },
              ),
            ),
          ],
        );
      case 'radius':
        final current = (state.valueOf(definition.key) as num?)?.toDouble() ??
            (state.values['location'] is Map
                ? (state.values['location']['radiusKm'] as num?)?.toDouble()
                : null);
        return Wrap(
          spacing: 8,
          children: [
            for (final km in [1.0, 5.0, 10.0, 25.0, 50.0, 100.0])
              ChoiceChip(
                label: Text('${km.toInt()} km'),
                selected: current == km,
                onSelected: (s) => onChanged(s ? km : null),
              ),
          ],
        );
      case 'searchable_select':
        return _SearchableSelect(
          definition: definition,
          value: state.valueOf(definition.key)?.toString(),
          lookups: lookups,
          onNeedLookup: onNeedLookup,
          onChanged: onChanged,
        );
      case 'location':
        return _LocationControl(state: state, onChanged: () => onChanged(state.values['location']));
      default:
        return TextField(
          decoration: InputDecoration(labelText: definition.label),
          onChanged: onChanged,
        );
    }
  }
}

class _LookupTrigger extends StatefulWidget {
  const _LookupTrigger({required this.onNeedLookup, required this.child});
  final VoidCallback onNeedLookup;
  final Widget child;

  @override
  State<_LookupTrigger> createState() => _LookupTriggerState();
}

class _LookupTriggerState extends State<_LookupTrigger> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => widget.onNeedLookup());
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

class _SearchableSelect extends StatefulWidget {
  const _SearchableSelect({
    required this.definition,
    required this.value,
    required this.lookups,
    required this.onNeedLookup,
    required this.onChanged,
  });

  final FilterDefinition definition;
  final String? value;
  final List<FilterLookupItem> lookups;
  final VoidCallback onNeedLookup;
  final ValueChanged<dynamic> onChanged;

  @override
  State<_SearchableSelect> createState() => _SearchableSelectState();
}

class _SearchableSelectState extends State<_SearchableSelect> {
  @override
  void initState() {
    super.initState();
    if (widget.lookups.isEmpty && widget.definition.allowedValues.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => widget.onNeedLookup());
    }
  }

  @override
  void didUpdateWidget(covariant _SearchableSelect oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.lookups.isEmpty && widget.definition.allowedValues.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => widget.onNeedLookup());
    }
  }

  @override
  Widget build(BuildContext context) {
    final options = widget.lookups.isNotEmpty
        ? widget.lookups
        : widget.definition.allowedValues
            .map((e) => FilterLookupItem(value: e.value, label: e.label))
            .toList();
    final values = options.map((e) => e.value).toSet();
    final selected = values.contains(widget.value) ? widget.value : null;
    return DropdownButtonFormField<String>(
      key: ValueKey('${widget.definition.key}-$selected-${options.length}'),
      initialValue: selected,
      decoration: InputDecoration(labelText: widget.definition.label),
      items: [
        for (final item in options)
          DropdownMenuItem(value: item.value, child: Text(item.label)),
      ],
      onChanged: widget.onChanged,
    );
  }
}

class _LocationControl extends StatefulWidget {
  const _LocationControl({required this.state, required this.onChanged});
  final FilterState state;
  final VoidCallback onChanged;

  @override
  State<_LocationControl> createState() => _LocationControlState();
}

class _LocationControlState extends State<_LocationControl> {
  late final _controller = TextEditingController(
    text: (widget.state.values['location'] is Map
            ? widget.state.values['location']['label']
            : null)
        ?.toString() ??
        '',
  );
  bool _busy = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _geocode() async {
    final q = _controller.text.trim();
    if (q.length < 2) return;
    setState(() => _busy = true);
    final sl = ServiceLocator.instance;
    final result = await sl.locationService.forward(
      q,
      countryId: sl.settingsRepository.countryId,
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (result == null || result.precision == 'none') {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No matching place. Try a city or area name.')),
      );
      return;
    }
    final location = <String, dynamic>{
      if (result.cityId != null) 'cityId': result.cityId,
      if (result.areaId != null) 'areaId': result.areaId,
      if (result.countryId != null) 'countryId': result.countryId,
      'label': result.areaName ?? result.cityName ?? q,
      if (result.latitude != null) 'lat': result.latitude,
      if (result.longitude != null) 'lng': result.longitude,
    };
    widget.state.setValue('location', location);
    if (result.cityId != null) widget.state.setValue('cityId', result.cityId);
    widget.onChanged();
  }

  Future<void> _gps() async {
    setState(() => _busy = true);
    final sl = ServiceLocator.instance;
    final gps = await sl.locationService.currentGps();
    if (!mounted) return;
    if (gps == null) {
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Location permission is required.')),
      );
      return;
    }
    final reverse = await sl.locationService.reverse(lat: gps.lat, lng: gps.lng);
    if (!mounted) return;
    setState(() => _busy = false);
    final location = <String, dynamic>{
      'lat': gps.lat,
      'lng': gps.lng,
      'label': reverse?.cityName ?? 'Current location',
      if (reverse?.cityId != null) 'cityId': reverse!.cityId,
    };
    _controller.text = location['label'] as String;
    widget.state.setValue('location', location);
    widget.onChanged();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        TextField(
          controller: _controller,
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            hintText: 'City, area, or “Lahore DHA Phase 6”',
            suffixIcon: _busy
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                  )
                : IconButton(icon: const Icon(Icons.search), onPressed: _geocode),
          ),
          onSubmitted: (_) => _geocode(),
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: _gps,
            icon: const Icon(Icons.my_location, size: 18),
            label: const Text('Use my location'),
          ),
        ),
      ],
    );
  }
}

class _NumberField extends StatefulWidget {
  const _NumberField({this.label, this.value, required this.onChanged});
  final String? label;
  final double? value;
  final ValueChanged<double?> onChanged;

  @override
  State<_NumberField> createState() => _NumberFieldState();
}

class _NumberFieldState extends State<_NumberField> {
  late final _controller = TextEditingController(
    text: widget.value == null
        ? ''
        : widget.value == widget.value!.roundToDouble()
            ? widget.value!.toStringAsFixed(0)
            : widget.value.toString(),
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      keyboardType: TextInputType.number,
      decoration: InputDecoration(labelText: widget.label),
      onChanged: (v) => widget.onChanged(double.tryParse(v)),
    );
  }
}
