// src/lib/weather.js
// Fetches 7-day forecast from Open-Meteo (free, no API key)
// Uses zippopotam.us for zip → lat/lon geocoding

const ZIP_CACHE = {};

async function getCoords(zip) {
  if (ZIP_CACHE[zip]) return ZIP_CACHE[zip];
  const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
  if (!res.ok) throw new Error('zip lookup failed');
  const data = await res.json();
  const place = data.places?.[0];
  if (!place) throw new Error('no place for zip');
  const coords = { lat: parseFloat(place.latitude), lon: parseFloat(place.longitude), city: place['place name'], state: place['state abbreviation'] };
  ZIP_CACHE[zip] = coords;
  return coords;
}

export function weatherCodeToLabel(code) {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 48) return 'Foggy';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 99) return 'Thunderstorm';
  return 'Unknown';
}

export function weatherCodeToEmoji(code) {
  if (code === 0) return '☀️';
  if (code <= 2) return '⛅';
  if (code <= 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 57) return '🌦️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦️';
  if (code <= 99) return '⛈️';
  return '🌡️';
}

function isOutdoorFriendly(code, precipProb, windKmh) {
  if (code >= 51) return false;
  if (precipProb > 40) return false;
  if (windKmh > 40) return false;
  return true;
}

export async function fetchWeeklyWeather(zip = '50063') {
  try {
    const { lat, lon, city, state } = await getCoords(zip);
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=precipitation_probability_max,weathercode,temperature_2m_max,temperature_2m_min,wind_speed_10m_max` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FChicago&forecast_days=7`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const times = data.daily?.time || [];
    const forecast = times.map((date, i) => ({
      date,
      code:             data.daily.weathercode[i],
      label:            weatherCodeToLabel(data.daily.weathercode[i]),
      maxTemp:          Math.round(data.daily.temperature_2m_max[i]),
      minTemp:          Math.round(data.daily.temperature_2m_min[i]),
      precipProbability: data.daily.precipitation_probability_max[i],
      windSpeed:        Math.round(data.daily.wind_speed_10m_max[i]),
      outdoorFriendly:  isOutdoorFriendly(
        data.daily.weathercode[i],
        data.daily.precipitation_probability_max[i],
        data.daily.wind_speed_10m_max[i]
      ),
    }));
    return { forecast, location: `${city}, ${state}` };
  } catch {
    return null;
  }
}

// Detect outdoor-related keywords in task title or tags
const OUTDOOR_KEYWORDS = ['outdoor', 'yard', 'lawn', 'mow', 'garden', 'exterior', 'deck', 'roof', 'paint', 'gutter', 'fence', 'driveway', 'power wash', 'trim'];

export function isOutdoorTask(task) {
  const text = `${task.title || ''} ${(task.tags || []).join(' ')}`.toLowerCase();
  return OUTDOOR_KEYWORDS.some(kw => text.includes(kw));
}
