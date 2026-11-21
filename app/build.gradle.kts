plugins {
    id("com.android.application")
}

android {
    namespace = "app.receiptradar"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.receiptradar"
        minSdk = 24
        targetSdk = 34
        versionCode = 4
        versionName = "1.1.1"
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
    }

    signingConfigs {
        create("release") {
            storeFile = rootProject.file("keystore/receiptradar.jks")
            storePassword = "receiptradar"
            keyAlias = "receiptradar"
            keyPassword = "receiptradar"
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets.getByName("main").assets.srcDir("build/generated/webassets")
}

// Bundle the web UI (without the Tesseract files, which are only used for desktop-browser testing)
val copyWeb by tasks.registering(Sync::class) {
    from(rootProject.file("web")) {
        exclude("vendor/**", "tessdata/**", "harness.html", "exp.html", "testimg")
    }
    into(layout.buildDirectory.dir("generated/webassets/www"))
}
tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
    // Google ML Kit text recognition, Latin script, model bundled in the app (works offline, no Play Services needed)
    implementation("com.google.mlkit:text-recognition:16.0.1")
}
