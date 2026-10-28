plugins {
    id("com.android.application")
}

android {
    namespace = "com.mercyy.transmission"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.mercyy.transmission"
        minSdk = 23
        targetSdk = 33
        versionCode = 3
        versionName = "3.0"
    }

    flavorDimensions += "edition"
    productFlavors {
        create("standard") {
            dimension = "edition"
            resValue("string", "app_name", "传讯")
        }
        create("darkfix") {
            dimension = "edition"
            applicationIdSuffix = ".new"
            resValue("string", "app_name", "传讯新版")
        }
    }

    buildTypes {
        debug { isDebuggable = true }
        release { isMinifyEnabled = false }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.android.material:material:1.12.0")
}
