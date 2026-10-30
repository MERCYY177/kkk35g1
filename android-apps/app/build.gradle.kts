plugins {
    id("com.android.application")
}

// The APK embeds the complete runtime web project below assets/site/.
// Keep this staging step in Gradle so local builds and CI build identical trees.
val webProjectRoot = rootProject.projectDir.parentFile
val generatedWebAssets = layout.buildDirectory.dir("generated/web-assets")
val stageWebProject by tasks.registering(Sync::class) {
    from(webProjectRoot) {
        include("index.html")
        include("*.html")
        include("*.js")
        include("*.css")
        include("*.json")
        include("assets/**")
        exclude(".git/**", ".github/**", "android-apps/**", "tests/**")
    }
    into(generatedWebAssets.map { it.dir("site") })
}

android {
    namespace = "com.mercyy.transmission"
    compileSdk = 35

    defaultConfig {
        // Retain the existing first app identity for in-place updates.
        applicationId = "com.mercyy.transmission"
        minSdk = 23
        targetSdk = 33
        versionCode = 6
        versionName = "6.0"
    }

    sourceSets.getByName("main").assets.srcDir(generatedWebAssets)

    flavorDimensions += "edition"
    productFlavors {
        create("chuanxun1") {
            dimension = "edition"
            applicationId = "com.mercyy.transmission"
            resValue("string", "app_name", "传讯1")
        }
        create("chuanxun2") {
            dimension = "edition"
            // Keep the former darkfix package identity, so existing installs
            // of that edition can be upgraded instead of silently duplicated.
            applicationId = "com.mercyy.transmission.new"
            resValue("string", "app_name", "传讯2")
        }
        create("chuanxun3") {
            dimension = "edition"
            applicationId = "com.mercyy177.chuanxun.three"
            resValue("string", "app_name", "传讯3")
        }
    }

    buildTypes {
        debug { isDebuggable = true }
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

tasks.named("preBuild").configure {
    dependsOn(stageWebProject)
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.android.material:material:1.12.0")
}
