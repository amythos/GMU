(function () {
    'use strict';

    var
        //Q 是一个实现了promise/A+规范的js库
        Q = require('q'),

        //用来根据规则查找文件的工具
        glob = require('glob'),
        path = require('path'),

        //用来判断某字符串是否满足某规则
        minimatch = require('minimatch'),
        file = require('./util/file'),
        helper = require('./util/helper'),
        config = require('./config.json').dist,
        run;

    //合并zepto文件
    function concatZepto() {
        var opt = config.zepto,
            dest = opt.dest,
            files = opt.files;

        files = files
            .split(' ')
            .map(function (file) {
                return opt.path + file + '.js';
            });

        file.concat(files, dest, opt.banner);

        console.log('生成 %s 成功， 大小为: %s ', dest, file.caculateSize(dest));
    }

    //用uglify压缩zepto文件
    function minifyZepto() {
        var opt = config.zepto,
            minDest = opt.dest.replace(/\.js$/, '.min.js');

        file.write(minDest, opt.banner + '\n' + file.minify(opt.dest));
        console.log('生成 %s 成功， 大小为: %s ', minDest, file.caculateSize(minDest));
    }

    //收集需要处理的js文件
    function collectComponents(exclude) {
        var opt = config.gmu,
            dir = path.resolve(opt.path),
            files = opt.src,

            //判断文件名是否满足exclude中设置的规则
            matchExclude = function (item) {
                var i = 0,
                    len = exclude.length;

                for (; i < len; i++) {

                    if (minimatch(item, exclude[i])) {
                        return true;
                    }
                }

                return false;
            };

        exclude = (opt.exclude || [])
            .concat(exclude ? exclude.split(/\s+/) : []);

        //确保files是个数组
        if (!Array.isArray(files)) {
            files = [files];
        }

        return Q.all(files.map(function (file) {
                return Q.nfcall(glob, file, { cwd: dir});
            }))
            .then(function (files) {

                return files

                    //摊平数组
                    .reduce(function (prefix, now) {
                        return prefix.concat(now);
                    })

                    //去重
                    .filter(function (item, i, me) {
                        return me.lastIndexOf(item) === i && 
                                !matchExclude(item);
                    });
            });
    }

    function buildComponents(files) {
        var opt = config.gmu,
            prefix = path.resolve(opt.path) + path.sep,
            cssPrefix = path.resolve(opt.cssPath) + path.sep,
            ret = [],
            hash = {},
            parse = function (path) {
                var css = {},
                    content,
                    cssPath,
                    exists,
                    depends,//dependencies
                    item,
                    matches;

                //如果文件不存在，则直接跳过, 同时从数组中过滤掉
                //或者已经处理过也跳过
                if (!(exists = file.exists((prefix + path))) ||
                    hash.hasOwnProperty(path)) {

                    return exists;
                }

                content = file.read(prefix + path);

                //读取文件内容中对js的依赖 格式为：@import core/zepto.js
                matches = content.match(/@import\s(.*?)\n/i);
                if (matches) {
                    depends = matches[1]

                        //多个依赖用道号隔开
                        .split(/\s*,\s*/g)
                        .filter(parse);
                }

                //查找css文件
                cssPath = path.replace(/\/(.+)\.js$/, function (m0, m1, m2) {
                    m1 = ~~m1;
                    return '-' + (m1 + 1) + '.' + m2;
                });

                //检查骨架css是否存在
                if (file.exists(cssPrefix + cssPath)) {
                    css.structor = cssPath;
                }

                //获取themes
                glob.sync(cssPath.replace(/\.css$/, '.*.css'), {cwd: cssPrefix})
                    .forEach(function (item) {
                        var m = item.match(/\.(.*)\.css$/i);
                        m && (css[m[1]] = item );
                    });

                //读取文件内容中对css的依赖 格式为：@importCSS loading.css
                matches = content.match(/@importCSS\s(.*?)\n/i);
                if (matches) {
                    css.dependencies = matches[1]

                        //多个依赖用道号隔开
                        .split(/\s*,\s*/g)
                        .map(function (item) {
                            var ret = {};

                            //可能只有骨架css存在，可能只有主题css存在
                            file.exists(cssPrefix + item) && 
                                    (ret.structor = item);
                            glob.sync(item.replace(/\.css$/, '.*.css'), 
                                    {cwd: cssPrefix})

                                .forEach(function (item) {
                                    var m = item.match(/\.(.*)\.css$/i);
                                    m && (ret[m[1]] = item );
                                });
                            return ret;
                        });
                }

                item = {
                    path: path,
                    dependencies: depends,
                    css: css
                };

                //将path作为key保存在hash表中，以避免重复解析
                hash[path] = item;
                ret.push(item);

                return true;
            };

        files.filter(parse);

        return ret;
    }

    function concatComponents(theme, models) {

        if (typeof theme !== 'string') {
            models = theme;
            theme = 'default';
        }

        var js = '',
            css = '',
            pkg = require('../package.json'),

            //存取css文件中的图片信息 key为url()括号中的值，value为原始图片路径
            images = {},
            opt = config.gmu,
            prefix = path.resolve(opt.path) + path.sep,
            cssPrefix = path.resolve(opt.cssPath) + path.sep,
            hash = {},
            rendered = {
                'core/zepto.js': true//不再输出core/zepto.js, 这个文件会单独打包
            },
            jsRender = function (item) {

                //如果存在js依赖，先输出依赖
                if (item.dependencies) {
                    item.dependencies.forEach(function (item) {
                        hash[item.path] && jsRender(hash[item.path]);
                    });
                }

                //如果已经输出过，不在重复输出
                if (rendered[item.path]) {
                    return;
                }

                js += file.read(prefix + item.path) + '\n';

                //标明已经输出过
                rendered[item.path] = true;
            },

            readCss = function (obj) {
                var ret = '',
                    i = 0,
                    matches,
                    len,
                    url;

                obj.structor && 
                        (ret += file.read(cssPrefix + obj.structor) + '\n');

                theme && obj[theme] && 
                        (ret += file.read(cssPrefix + obj[theme]) + '\n');

                //收集images
                matches = ret.match(/url\(((['"]?)(?!data)([^'"\n]+?)\2)\)/ig);

                if (matches) {

                    for (len = matches.length; i < len; i++) {

                        //苦恼，为何matches结果里面不带分组结果呢？
                        url = matches[i].match(
                                /url\(((['"]?)(?!data)([^'"\n]+?)\2)\)/i)[3];

                        images[url] = path.resolve(cssPrefix + 
                                path.dirname(obj.structor || obj[theme]) + 
                                path.sep + url);
                    }
                }

                css += ret;
            },
            cssRender = function (item) {
                var css;

                //先输出js依赖对应的css
                if (item.dependencies) {
                    item.dependencies.forEach(function (item) {
                        hash[item.path] && cssRender(hash[item.path]);
                    });
                }

                css = item.css;

                if (css.dependencies) {
                    css.dependencies.forEach(readCss);
                }

                readCss(css);
            },
            replaceFn = function (m0, m1, m2) {
                m1 = m1 >> 0;
                return '-' + (m1 + 1) + '.' + m2;
            },
            dest,
            minDest,
            destDir,
            image,
            newName,
            banner;

        //生成hash表
        models.forEach(function (item) {
            hash[item.path] = item;
        });


        models.forEach(jsRender);
        models.forEach(cssRender);

        banner = opt.banner.replace(/@version/g, pkg.version);

        dest = opt.dest;
        file.write(dest, banner + '\n' + js);

        console.log('生成 %s 成功， 大小为: %s ', dest, file.caculateSize(dest));

        minDest = dest.replace(/\.js$/, '.min.js');
        file.write(minDest, banner + '\n' + file.minify(dest));
        console.log('生成 %s 成功， 大小为: %s ', minDest, file.caculateSize(minDest));

        //复制图片
        destDir = path.dirname(dest) + path.sep;
        for (image in images) {
            
            if( images.hasOwnProperty( image ) ) {
                newName = path.basename(image);

                //如果文件名已经占用，则换个名字
                while (file.exists(destDir + 'images/' + newName)) {
                    newName = newName
                            .replace(/(?:-(\d+))?\.(png|jpg|jpeg|gif)$/i, 
                            replaceFn);
                }

                file.write(destDir + 'images/' + newName, 
                        file.read(images[image]));

                css = helper
                    .strReplace('\\((\'|")?' + 
                            image.replace(/\./g, '\\.') + '\\1\\)', 
                            '(./images/' + newName + ')', css);
            }
        }

        dest = dest.replace(/\.js$/, '.css');
        file.write(dest, banner + '\n' + css);
        console.log('生成 %s 成功， 大小为: %s ', dest, file.caculateSize(dest));
    }

    //提供直接调用
    exports.run = function () {
        var exclude = this.exclude;

        return Q
            .fcall(concatZepto)
            .then(minifyZepto)
            .then(helper.curry(collectComponents, exclude))
            .then(buildComponents)
            .then(concatComponents);
    };

    //标记是一个task
    exports.task = true;

    exports.init = function (cli) {
        cli.option('-X, --exclude <files...>', '在打包GMU的时候，' + 
                '可以通过此Option来过滤掉不需要的文件，格式与glob一致');

        cli.command('dist')
            .description('合并代码并采用uglify压缩代码')
            .action(run.bind(cli));
    };

    //暴露给fis用
    exports.getComponents = function( exclude ){
        return collectComponents(exclude)
            .then(buildComponents);
    };

})();