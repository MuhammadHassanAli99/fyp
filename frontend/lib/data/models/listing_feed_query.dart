/// Mutable feed query aligned with backend listing + marketplace filters.
class ListingFeedQuery {
  ListingFeedQuery({
    this.marketplace = 'gold',
    this.sort = 'newest',
    this.q,
    this.operation,
    this.condition,
    this.page = 1,
    this.perPage = 20,
    this.cursor,
    this.priceMin,
    this.priceMax,
    this.cityId,
    this.verifiedSeller = false,
    this.withPhotos = false,
    this.featuredOnly = false,
    // Property
    this.propertyKind,
    this.bedroomsMin,
    this.bathroomsMin,
    this.areaMin,
    this.areaMax,
    this.areaUnit,
    this.furnishing,
    this.constructionStatus,
    this.parkingMin,
    this.swimmingPool = false,
    this.gym = false,
    this.garden = false,
    this.elevator = false,
    this.gatedCommunity = false,
    this.usageType,
    this.balcony = false,
    this.verifiedProperty = false,
    // Vehicles
    this.vehicleType,
    this.makeId,
    this.modelId,
    this.yearMin,
    this.yearMax,
    this.mileageMax,
    this.fuelType,
    this.transmission,
    this.bodyType,
    this.inspected = false,
    this.financeAvailable = false,
    this.accidentHistory,
    // Gold
    this.karat,
    this.weightMin,
    this.weightMax,
    this.form,
    this.hallmarked = false,
    this.certified = false,
    this.investmentGrade = false,
    this.antique = false,
    this.scrap = false,
    this.brandId,
    this.sellerType,
    this.finenessMin,
    this.finenessMax,
  });

  String marketplace;
  String sort;
  String? q;
  String? operation;
  /// Listing condition code (e.g. `new`, `used`) — used for vehicle compare tabs.
  String? condition;
  int page;
  int perPage;
  String? cursor;
  double? priceMin;
  double? priceMax;
  int? cityId;
  bool verifiedSeller;
  bool withPhotos;
  bool featuredOnly;

  // Property (Zameen)
  String? propertyKind;
  int? bedroomsMin;
  int? bathroomsMin;
  double? areaMin;
  double? areaMax;
  String? areaUnit;
  String? furnishing;
  String? constructionStatus;
  int? parkingMin;
  bool swimmingPool;
  bool gym;
  bool garden;
  bool elevator;
  bool gatedCommunity;
  String? usageType;
  bool balcony;
  bool verifiedProperty;

  // Vehicles (PakWheels)
  String? vehicleType;
  int? makeId;
  int? modelId;
  int? yearMin;
  int? yearMax;
  int? mileageMax;
  String? fuelType;
  String? transmission;
  String? bodyType;
  bool inspected;
  bool financeAvailable;
  String? accidentHistory;

  // Gold
  String? karat;
  double? weightMin;
  double? weightMax;
  String? form;
  bool hallmarked;
  bool certified;
  bool investmentGrade;
  bool antique;
  bool scrap;
  int? brandId;
  String? sellerType;
  double? finenessMin;
  double? finenessMax;

  int get activeFilterCount {
    var n = 0;
    if (operation != null) n++;
    if (priceMin != null || priceMax != null) n++;
    if (verifiedSeller) n++;
    if (withPhotos) n++;
    if (featuredOnly) n++;
    if (propertyKind != null) n++;
    if (bedroomsMin != null) n++;
    if (bathroomsMin != null) n++;
    if (areaMin != null || areaMax != null) n++;
    if (furnishing != null) n++;
    if (constructionStatus != null) n++;
    if (parkingMin != null) n++;
    if (swimmingPool || gym || garden || elevator || gatedCommunity || balcony) n++;
    if (usageType != null) n++;
    if (verifiedProperty) n++;
    if (vehicleType != null) n++;
    if (makeId != null) n++;
    if (modelId != null) n++;
    if (yearMin != null || yearMax != null) n++;
    if (mileageMax != null) n++;
    if (fuelType != null) n++;
    if (transmission != null) n++;
    if (bodyType != null) n++;
    if (inspected) n++;
    if (financeAvailable) n++;
    if (accidentHistory != null) n++;
    if (karat != null) n++;
    if (weightMin != null || weightMax != null) n++;
    if (form != null) n++;
    if (hallmarked || certified || investmentGrade || antique || scrap) n++;
    if (brandId != null) n++;
    if (sellerType != null) n++;
    if (finenessMin != null || finenessMax != null) n++;
    return n;
  }

  void clearFilters() {
    operation = null;
    condition = null;
    priceMin = null;
    priceMax = null;
    cityId = null;
    verifiedSeller = false;
    withPhotos = false;
    featuredOnly = false;
    propertyKind = null;
    bedroomsMin = null;
    bathroomsMin = null;
    areaMin = null;
    areaMax = null;
    areaUnit = null;
    furnishing = null;
    constructionStatus = null;
    parkingMin = null;
    swimmingPool = false;
    gym = false;
    garden = false;
    elevator = false;
    gatedCommunity = false;
    usageType = null;
    balcony = false;
    verifiedProperty = false;
    vehicleType = null;
    makeId = null;
    modelId = null;
    yearMin = null;
    yearMax = null;
    mileageMax = null;
    fuelType = null;
    transmission = null;
    bodyType = null;
    inspected = false;
    financeAvailable = false;
    accidentHistory = null;
    karat = null;
    weightMin = null;
    weightMax = null;
    form = null;
    hallmarked = false;
    certified = false;
    investmentGrade = false;
    antique = false;
    scrap = false;
    brandId = null;
    sellerType = null;
    finenessMin = null;
    finenessMax = null;
    page = 1;
    cursor = null;
  }

  Map<String, dynamic> toQueryParameters() {
    final map = <String, dynamic>{
      'marketplace': marketplace,
      'sort': sort,
      'page': page,
      'perPage': perPage,
      if (cursor != null && cursor!.isNotEmpty) 'cursor': cursor,
      if (q != null && q!.isNotEmpty) 'q': q,
      if (operation != null) 'operation': operation,
      if (condition != null) 'condition': condition,
      if (priceMin != null) 'priceMin': priceMin,
      if (priceMax != null) 'priceMax': priceMax,
      if (cityId != null) 'cityId': cityId,
      if (verifiedSeller) 'verifiedSeller': true,
      if (withPhotos) 'withPhotos': true,
      if (featuredOnly) 'featuredOnly': true,
    };

    if (marketplace == 'property') {
      map.addAll({
        if (propertyKind != null) 'propertyKind': propertyKind,
        if (bedroomsMin != null) 'bedroomsMin': bedroomsMin,
        if (bathroomsMin != null) 'bathroomsMin': bathroomsMin,
        if (areaMin != null) 'areaMin': areaMin,
        if (areaMax != null) 'areaMax': areaMax,
        if (areaUnit != null) 'areaUnit': areaUnit,
        if (furnishing != null) 'furnishing': furnishing,
        if (constructionStatus != null) 'constructionStatus': constructionStatus,
        if (parkingMin != null) 'parkingMin': parkingMin,
        if (swimmingPool) 'swimmingPool': true,
        if (gym) 'gym': true,
        if (garden) 'garden': true,
        if (elevator) 'elevator': true,
        if (gatedCommunity) 'gatedCommunity': true,
        if (usageType != null) 'usageType': usageType,
        if (balcony) 'balcony': true,
        if (verifiedProperty) 'verifiedProperty': true,
      });
    }

    if (marketplace == 'vehicles') {
      map.addAll({
        if (vehicleType != null) 'vehicleType': vehicleType,
        if (makeId != null) 'makeId': makeId,
        if (modelId != null) 'modelId': modelId,
        if (yearMin != null) 'yearMin': yearMin,
        if (yearMax != null) 'yearMax': yearMax,
        if (mileageMax != null) 'mileageMax': mileageMax,
        if (fuelType != null) 'fuelType': fuelType,
        if (transmission != null) 'transmission': transmission,
        if (bodyType != null) 'bodyType': bodyType,
        if (inspected) 'inspected': true,
        if (financeAvailable) 'financeAvailable': true,
        if (accidentHistory != null) 'accidentHistory': accidentHistory,
      });
    }

    if (marketplace == 'gold') {
      map.addAll({
        if (karat != null) 'karat': karat,
        if (weightMin != null) 'weightMin': weightMin,
        if (weightMax != null) 'weightMax': weightMax,
        if (form != null) 'form': form,
        if (hallmarked) 'hallmarked': true,
        if (certified) 'certified': true,
        if (investmentGrade) 'investmentGrade': true,
        if (antique) 'antique': true,
        if (scrap) 'scrap': true,
        if (brandId != null) 'brandId': brandId,
        if (sellerType != null) 'sellerType': sellerType,
        if (finenessMin != null) 'finenessMin': finenessMin,
        if (finenessMax != null) 'finenessMax': finenessMax,
      });
    }

    return map;
  }

  ListingFeedQuery copy() => ListingFeedQuery(
        marketplace: marketplace,
        sort: sort,
        q: q,
        operation: operation,
        condition: condition,
        page: page,
        perPage: perPage,
        cursor: cursor,
        priceMin: priceMin,
        priceMax: priceMax,
        cityId: cityId,
        verifiedSeller: verifiedSeller,
        withPhotos: withPhotos,
        featuredOnly: featuredOnly,
        propertyKind: propertyKind,
        bedroomsMin: bedroomsMin,
        bathroomsMin: bathroomsMin,
        areaMin: areaMin,
        areaMax: areaMax,
        areaUnit: areaUnit,
        furnishing: furnishing,
        constructionStatus: constructionStatus,
        parkingMin: parkingMin,
        swimmingPool: swimmingPool,
        gym: gym,
        garden: garden,
        elevator: elevator,
        gatedCommunity: gatedCommunity,
        usageType: usageType,
        balcony: balcony,
        verifiedProperty: verifiedProperty,
        vehicleType: vehicleType,
        makeId: makeId,
        modelId: modelId,
        yearMin: yearMin,
        yearMax: yearMax,
        mileageMax: mileageMax,
        fuelType: fuelType,
        transmission: transmission,
        bodyType: bodyType,
        inspected: inspected,
        financeAvailable: financeAvailable,
        accidentHistory: accidentHistory,
        karat: karat,
        weightMin: weightMin,
        weightMax: weightMax,
        form: form,
        hallmarked: hallmarked,
        certified: certified,
        investmentGrade: investmentGrade,
        antique: antique,
        scrap: scrap,
        brandId: brandId,
        sellerType: sellerType,
        finenessMin: finenessMin,
        finenessMax: finenessMax,
      );
}
