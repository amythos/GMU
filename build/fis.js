/**
 * @fileOverview 负责生成fis包。
 * 生成路径 dist/fis/gmu_@version.
 *
 * 未完工。
 */
(function(){
    'use strict';

    var dist = require('./dist'),
        file = require('./util/file'),
        helper = require('./util/helper'),
        Q = require('q'),
        path = require('path'),
        pkg = require("../package"),
        config = require("./config"),
        prefix = path.resolve(config.dist.gmu.path) + path.sep,
        cssPrefix = path.resolve(config.dist.gmu.cssPath) + path.sep,
        fisBase = path.resolve(config.fis.dest.replace(/@version/ig, pkg.version)) + path.sep,
        plugins;

    function isEmptyObject ( obj ) {
        for ( var key in obj ) {
            return false;
        }
        return true;
    }
    function buildForFis( files ){
        plugins = getPlugins(files);

        //如果已经存在则删除
        file.rmdir(fisBase);
        file.mkdir(fisBase);

        files
            /*.filter(function( item ){
             return item.path !== 'core/zepto.js';
             })*/
            .forEach(createFiles);
    }

    function createFiles (item) {
        var fd = parseItem(item),
            skinfd = parseItemSkin(item),
            buffer, read, skin;

        if (fd) {
            //创建base及骨架组件文件
            ['js', 'css'].forEach(function (type) {
                read = fd.read;
                if (read && read[type]) {
                    buffer = (read[type + 'desp'] ? read[type + 'desp'].join(';\n') : '') + file.read(read[type]) + '\n' + (read[type + 'exports'] ? read[type + 'exports'] : '');
                    //收集图片写入fis中
                    type === 'css' && (buffer = renderImages(buffer, path.dirname(read[type]), path.dirname(fisBase + fd.write[type])));
                    file.write(fisBase + fd.write[type], buffer);
                }

            });

            //创建commoncss文件
            if (fd.read.comcss) {
                fd.read.comcss.forEach(function (item, i) {
                    buffer = renderImages(file.read(item), path.dirname(item), path.dirname(fisBase + fd.write.comcss[i]));
                    file.write(fisBase + fd.write.comcss[i], buffer);
                })
            }
        }

        if (skinfd) {
            //创建组件皮肤文件
            for (skin in skinfd.read) {
                if (skinfd.read.hasOwnProperty(skin)) {
                    skinfd.read[skin].buffer && file.write(fisBase + skinfd.write[skin].js, skinfd.read[skin].buffer);    //写入js
                    if (skinfd.read[skin].css) {
                        buffer = renderImages(file.read(skinfd.read[skin].css), path.dirname(skinfd.read[skin].css), path.dirname(fisBase + skinfd.write[skin].css));
                        file.write(fisBase + skinfd.write[skin].css, buffer);    //写入css
                    }
                    skinfd.read[skin].plugin && skinfd.read[skin].plugin.forEach(function (buffer, i) {
                        file.write(fisBase + skinfd.write[skin].plugin[i], buffer);    //写入js
                    })
                }
            }
        }
    }

    function parseItem( item ) {
        var fis = parsePath(item.path),
            read = {},
            write = {};

        if(fis.base) {
            read.js = prefix + item.path;
            read.jsdesp = [];
            read.jsexports = fis.exports;
            item.dependencies && item.dependencies.forEach(function (desp) {
                var desPath = parsePath(desp).require;
                if (desPath) {
                    read.jsdesp.push("require('gmu:" + desPath + "')");
                }
            });
            write.js = fis.base + '.js';

            if (item.css.structor) {    //解析骨架css
                read.css = cssPrefix + item.css.structor;
                write.css = fis.base + '.css';
            }

            if (item.css.dependencies) {    //生成commoncss
                read.comcss = [];
                write.comcss = [];
                item.css.dependencies.forEach(function (desp) {
                    for (var theme in desp) {
                        if (desp.hasOwnProperty(theme)) {
                            read.comcss.push(cssPrefix + desp[theme]);
                            write.comcss.push('commoncss' + path.sep + path.basename(desp[theme]));
                        }
                    }
                });

            }
        }

        return isEmptyObject(read) ? null: {
            read: read,
            write: write
        }
    }

    function parseItemSkin (item) {
        var read = {},
            write = {},
            fis, skin;

        for (skin in item.css) {
            if (skin !== 'structor' && skin !== 'dependencies' && item.css.hasOwnProperty(skin)) {
                fis = parsePath(item.path, skin);
                read[skin] = {};
                write[skin] = {};
                if (!fis.plugin) {
                    read[skin].buffer = "exports = require('gmu:" + fis.require + "')";
                    write[skin].js = fis.base + path.sep + fis.name + '.' + skin + '.js';
                    read[skin].css = cssPrefix + item.css[skin];
                    write[skin].css = fis.base + path.sep + fis.name + '.' + skin + '.css';
                    if (fis.name === 'refresh') {debugger;}
                    plugins[fis.name] && plugins[fis.name].forEach(function (plugin) {
                        read[skin].plugin || (read[skin].plugin= []);
                        write[skin].plugin || (write[skin].plugin= []);
                        read[skin].plugin.push("require('gmu:" + fis.name + "." + skin + "');\nexports = require('gmu:" + fis.name + path.sep + plugin + "');");
                        write[skin].plugin.push(fis.base + path.sep + plugin + path.sep + fis.name + '.' + skin + '.js');
                    });
                } else {
                    read[skin].css = cssPrefix + item.css[skin];
                    write[skin].css = fis.base + path.sep + fis.plugin + path.sep + fis.name + '.' + skin + '.css';
                }
            }
        }
        return isEmptyObject(read) ? null: {
            read: read,
            write: write
        }
    }

    function parsePath (spath, skin) {
        var matches = spath.match(/([^\/]+)\/([^\/]+)\.js$/i),
            fis = {},
            fnArr;

        if (matches) {
            fnArr = matches[2].split('.');
            fis.require = (matches[1] === 'widget' ? fnArr[0] : (fnArr.length > 1 ? 'base' : 'zepto')) + (fnArr.length > 1 ? path.sep + fnArr[1] : '');
            fis.base = (matches[1] === 'widget' ? fnArr[0] : 'base') + path.sep + (fnArr.length > 1 ? ( fnArr[1] + path.sep + fnArr[1] ) : fnArr[0]);
            if (skin) {
                fis.base =  fnArr[0] + ('.' + skin);
            }
            fis.exports = 'exports=' + (matches[1] === 'widget' ? ('Zepto.ui.' + fnArr[0]) : 'Zepto') + ';';
            fis.name = fnArr[0];
            fis.plugin = (matches[1] === 'widget' && fnArr.length > 1) ? fnArr[1] : '';
            if (matches[1] === 'core' && fnArr.length === 1) {   //针对touch.js和zepto.js特殊处理
                switch (fnArr[0]) {
                    case 'touch':
                        fis.base = 'base' + path.sep + fnArr[0] + path.sep + fnArr[0];
                        break;
                    case 'zepto':
                        fis.base = fnArr[0] + path.sep + fnArr[0];
                        break;
                }
            }
        }

        return fis;
    }

    function getPlugins (data) {
        var plugins = {}, matches, fnArr;
        data.forEach(function (item) {
            matches = item.path.match(/([^\/]+)\/([^\/]+)\.js$/i);
            if (matches) {
                fnArr = matches[2].split('.');
                if (matches[1] === 'widget' && fnArr.length > 1) {
                    plugins[fnArr[0]] || (plugins[fnArr[0]] = []);
                    plugins[fnArr[0]].push(fnArr[1]);
                }
            }
        });
        return plugins;

    }

    function renderImages (content, rpath, wpath) {
        var url;

        return content.replace(/url\(((['"]?)(?!data)([^'"\n]+?)\2)\)/ig, function () {
            url = arguments[3];
            file.write(path.resolve(wpath + path.sep + path.basename(url)), file.read(path.resolve(rpath + path.sep + url)));
            return 'url(' + path.basename(url) + ')';
        });
    }

    //提供直接调用
    var run = exports.run = function() {
        var shell = require('./util/shell.js');
        return Q
            .try(dist.getComponents)
            .then(buildForFis)
            .then(function () {
                //shell('cd ' + path.resolve(fisBase, '../..'));
            })
            .then(function () {
                //shell('tar -zcf ' + pkg.version + '.tar.gz ' + pkg.version);
            })
            .fail(function(reason){
                console.log(reason);
            });
    };

    //标记是一个task
    exports.task = true;


    exports.init = function(cli) {
        cli.command('fis')
            .description('生成fis包')
            .action(run.bind(cli));
    };
})();