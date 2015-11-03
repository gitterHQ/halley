/* jshint node:true, unused:true */
'use strict';

var gulp       = require('gulp');
var webpack    = require('gulp-webpack');
var gzip       = require('gulp-gzip');
var sourcemaps = require('gulp-sourcemaps');
var gutil      = require('gulp-util');
var webpack    = require('webpack');
var uglify     = require('gulp-uglify');

gulp.task("webpack-standalone", function(callback) {
    // run webpack
    webpack({
      entry: "./browser-standalone.js",
      output: {
        path: "dist/",
        filename: "halley.js",
        libraryTarget: "umd",
        library: "Halley"
      },
      stats: true,

      failOnError: true,
    }, function(err, stats) {
        if(err) throw new gutil.PluginError("webpack", err);
        gutil.log("[webpack]", stats.toString({
            // output options
        }));
        callback();
    });
});

gulp.task("webpack-backbone", function(callback) {
    // run webpack
    webpack({
      entry: "./backbone.js",
      output: {
        path: "dist/",
        filename: "halley-backbone.js",
        libraryTarget: "umd",
        library: "Faye"
      },
      externals: {
        "backbone": "Backbone",
        "underscore": "_"
      },
      stats: true,

      failOnError: true,
    }, function(err, stats) {
        if(err) throw new gutil.PluginError("webpack", err);
        gutil.log("[webpack]", stats.toString({
            // output options
        }));
        callback();
    });
});
gulp.task('webpack', ['webpack-backbone', 'webpack-standalone']);

gulp.task('uglify', ['webpack'], function() {
  return gulp.src('dist/*.js', { base: 'dist/' })
    .pipe(sourcemaps.init({ loadMaps: true }))
    .pipe(uglify({

    }))
    .pipe(sourcemaps.write("."))
    .pipe(gulp.dest('dist/min'));
});

gulp.task('gzip', ['uglify'], function () {
    return gulp.src(['dist/min/**'], { stat: true })
      .pipe(gzip({ append: true, gzipOptions: { level: 9 } }))
      .pipe(gulp.dest('dist/min'));
});

gulp.task('default', ['webpack', 'uglify', 'gzip']);
