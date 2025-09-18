// ==========================
// 1. AMBIL BATAS WILAYAH ROI (BANGKA BELITUNG)
// ==========================
var gaulAdm1 = ee.FeatureCollection('FAO/GAUL/2015/level1')
  .filter(ee.Filter.eq('ADM0_NAME', 'Indonesia'));

var babel = gaulAdm1.filter(
  ee.Filter.or(ee.Filter.stringContains('ADM1_NAME', 'Bangka'))
).geometry();

Map.centerObject(babel, 7);
Map.addLayer(babel, {color: 'red'}, 'ROI - Kep. Bangka Belitung');

// Gunakan geometry ROI (Bangka Belitung)
var geometry = babel;


// ==========================
// 2. FUNGSI AMBIL CITRA PER TAHUN (DENGAN ERROR HANDLING)
// ==========================
function getEnvironmentalLayers(year) {
  year = ee.Number(year);
  var startDate = ee.Date.fromYMD(year, 1, 1);
  var endDate = ee.Date.fromYMD(year.add(1), 1, 1);
  
  function createEmptyImage(bandName) {
    return ee.Image.constant(-999).rename(bandName).toFloat();
  }

  // 2.1 HOTSPOT (FIRMS)
  var hotspotCol = ee.ImageCollection('FIRMS')
    .filterDate(startDate, endDate)
    .filterBounds(geometry);
  
  var hotspots = ee.Algorithms.If({
    condition: hotspotCol.size().gt(0),
    trueCase: hotspotCol.select('T21').max()
              .updateMask(hotspotCol.select('T21').max().gt(300))
              .toFloat()
              .rename('hotspots'),
    falseCase: createEmptyImage('hotspots')
  });

  // 2.2 CURAH HUJAN (CHIRPS)
  var precipCol = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
    .filterDate(startDate, endDate)
    .filterBounds(geometry);
  
  var precipitation = ee.Algorithms.If({
    condition: precipCol.size().gt(0),
    trueCase: precipCol.sum().rename('precipitation'),
    falseCase: createEmptyImage('precipitation')
  });

  // 2.3 SUHU (ERA5-LAND)
  var temp = ee.ImageCollection('ECMWF/ERA5_LAND/DAILY_AGGR')
    .filterDate(startDate, endDate)
    .select('temperature_2m_max')
    .mean()
    .subtract(273.15)
    .rename('temperature');

  // 2.4 KELEMBABAN (ERA5-LAND)
  var humidity = ee.ImageCollection('ECMWF/ERA5_LAND/DAILY_AGGR')
    .filterDate(startDate, endDate)
    .select('dewpoint_temperature_2m')
    .mean()
    .subtract(273.15)
    .rename('humidity');

  // 2.5 NDVI (MODIS)
  var ndviCol = ee.ImageCollection('MODIS/006/MOD13Q1')
    .filterDate(startDate, endDate)
    .filterBounds(geometry)
    .select('NDVI');
  
  var ndvi = ee.Algorithms.If({
    condition: ndviCol.size().gt(0),
    trueCase: ndviCol.mean().multiply(0.0001).rename('ndvi'),
    falseCase: createEmptyImage('ndvi')
  });

  // 2.6 LAND COVER (MODIS)
  var lcCol = ee.ImageCollection('MODIS/006/MCD12Q1')
    .filterDate(ee.Date.fromYMD(year, 1, 1), ee.Date.fromYMD(year, 12, 31));
  
  var landCover = ee.Algorithms.If({
    condition: lcCol.size().gt(0),
    trueCase: lcCol.first().select('LC_Type1').rename('land_cover'),
    falseCase: createEmptyImage('land_cover')
  });

  // 2.7 KECEPATAN ANGIN (ERA5)
  var windCol = ee.ImageCollection('ECMWF/ERA5/DAILY')
    .filterDate(startDate, endDate)
    .select(['u_component_of_wind_10m', 'v_component_of_wind_10m']);
  
  var windSpeed = ee.Algorithms.If({
    condition: windCol.size().gt(0),
    trueCase: windCol.mean().expression(
      'sqrt(u*u + v*v)', {
        'u': windCol.mean().select('u_component_of_wind_10m'),
        'v': windCol.mean().select('v_component_of_wind_10m')
      }).rename('wind_speed'),
    falseCase: createEmptyImage('wind_speed')
  });

  // Gabungkan semua layer dan potong ke ROI Bangka Belitung
  var stacked = ee.Image.cat([
    ee.Image(hotspots),
    ee.Image(precipitation),
    temp,
    humidity,
    ee.Image(ndvi),
    ee.Image(landCover),
    ee.Image(windSpeed)
  ]).set('year', year)
   .clip(geometry);

  return stacked;
}


// ==========================
// 3. BUAT IMAGE COLLECTION PER TAHUN (2019–2024)
// ==========================
var yearList = ee.List.sequence(2019, 2024);

var yearlyStack = yearList.map(function(y) {
  return getEnvironmentalLayers(y);
});

var imageCollection = ee.ImageCollection(yearlyStack);
print('ImageCollection lingkungan 2019–2024', imageCollection);


// ==========================
// 4. SAMPLING DAN EKSPOR KE DRIVE
// ==========================
yearList.getInfo().forEach(function(y) {
  var image = imageCollection.filter(ee.Filter.eq('year', y)).first();
  
  var bandNames = image.bandNames();
  print('Citra untuk tahun', y, 'memiliki band:', bandNames);

  try {
    Map.addLayer(image.select('hotspots'), {min: 300, max: 400, palette: ['yellow', 'red']}, 'Hotspots ' + y);
  } catch (e) {
    print('Tidak bisa menampilkan hotspots untuk tahun ' + y + ': ' + e);
  }

  if (bandNames.size().gt(0).getInfo()) {
    var samples = image.sample({
      region: geometry,
      scale: 1000,
      numPixels: 1000,
      seed: 42,
      geometries: true
    });

    Export.table.toDrive({
      collection: samples,
      description: 'EnvSample_' + y,
      folder: 'GEE_FIRE_CSV',
      fileNamePrefix: 'environment_' + y,
      fileFormat: 'CSV'
    });
  } else {
    print('Tidak ada data untuk tahun ' + y + ', ekspor dilewati');
  }
});
