import Testing
@testable import NexoKit
struct NexoLocaleTests {
    @Test func explainsFreeTextOverflowInBothLanguages() {
        let key = "El texto no cabe en la página. Muévelo hacia arriba, amplía su ancho o reduce su tamaño."
        #expect(NexoLocale.translate(key, language: "es") == key)
        #expect(NexoLocale.translate(key, language: "en") == "The text does not fit on the page. Move it up, widen it, or reduce its size.")
    }
    @Test func choosesSupportedLanguageAndKeepsNamesLiteral() {
        #expect(NexoLocale.resolveLanguage(["es_PR", "en-US"]) == "es")
        #expect(NexoLocale.resolveLanguage(["en-GB", "es"]) == "en")
        #expect(NexoLocale.resolveLanguage(["fr", "ja"]) == "en")
        #expect(NexoLocale.translate("Continuar en {0}", language: "en", values: ["Asociación · {1}"]) == "Continue in Asociación · {1}")
        #expect(NexoLocale.translate("Se subirán las personas, encuentros, asistencia y plantillas de {0} a la cuenta {1}.", language: "en", values: ["Grupo {1}", "team"]) == "People, events, attendance and templates from Grupo {1} will be uploaded to team.")
    }
}
