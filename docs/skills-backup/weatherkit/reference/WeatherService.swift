import Foundation
import WeatherKit
import CoreLocation

final class WeatherService {
    static let shared = WeatherService()
    private let weatherService = WeatherKit.WeatherService()

    struct WeatherData {
        let temperature: Int
        let condition: String
        let conditionIcon: String
        let feelsLike: Int?
        let humidity: Int?
        let windSpeed: Int?
    }

    func fetchWeather(for coordinate: CLLocationCoordinate2D) async throws -> WeatherData {
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)

        do {
            let weather = try await weatherService.weather(for: location)
            let current = weather.currentWeather

            let temp = Int(current.temperature.converted(to: .fahrenheit).value.rounded())
            let condition = current.condition.rawValue.replacingOccurrences(of: "_", with: " ").capitalized
            let icon = weatherIcon(for: current.condition)
            let feelsLike: Int? = nil  // feelsLikeTemperature not available in CurrentWeather
            let humidity: Int? = Int(current.humidity * 100)  // humidity is Double (0-1)
            let windSpeed: Int? = Int(current.wind.speed.value)

            return WeatherData(
                temperature: temp,
                condition: condition,
                conditionIcon: icon,
                feelsLike: feelsLike,
                humidity: humidity,
                windSpeed: windSpeed
            )
        } catch {
            throw APIError.network("Failed to fetch weather: \(error.localizedDescription)")
        }
    }

    private func weatherIcon(for condition: WeatherCondition) -> String {
        switch condition {
        case .clear:                    return "sun.max.fill"
        case .mostlyClear:              return "cloud.sun.fill"
        case .partlyCloudy:             return "cloud.sun.fill"
        case .mostlyCloudy:             return "cloud.fill"
        case .cloudy:                   return "cloud.fill"
        case .drizzle:                  return "cloud.drizzle.fill"
        case .rain, .heavyRain:         return "cloud.rain.fill"
        case .sunShowers:               return "cloud.sun.rain.fill"
        case .freezingRain, .freezingDrizzle: return "cloud.sleet.fill"
        case .thunderstorms, .isolatedThunderstorms, .scatteredThunderstorms, .strongStorms:
                                        return "cloud.bolt.rain.fill"
        case .snow, .heavySnow:         return "cloud.snow.fill"
        case .flurries, .sunFlurries:   return "cloud.snow.fill"
        case .blizzard, .blowingSnow:   return "wind.snow"
        case .sleet, .wintryMix:        return "cloud.sleet.fill"
        case .hail:                     return "cloud.hail.fill"
        case .foggy:                    return "cloud.fog.fill"
        case .smoky:                    return "smoke.fill"
        case .blowingDust:              return "sun.dust.fill"
        case .haze:                     return "sun.haze.fill"
        case .hot:                      return "thermometer.sun.fill"
        case .frigid:                   return "thermometer.snowflake"
        case .breezy, .windy:           return "wind"
        case .hurricane, .tropicalStorm: return "hurricane"
        @unknown default:               return "cloud.fill"
        }
    }
}
