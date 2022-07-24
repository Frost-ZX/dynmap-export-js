/**
 * @typedef DynmapInstance
 * @type {{
 *   map: {
 *     getZoom(): number,
 *     getMinZoom(): number,
 *     getMaxZoom(): number,
 *   },
 *   maptype: {
 *     getTileName(coords: { x: number, y: number }): string,
 *     options: {
 *       mapzoomin: number,
 *       mapzoomout: number,
 *       maxNativeZoom: number,
 *       maxZoom: number,
 *       name: string,
 *       prefix: string,
 *       tileSize: number,
 *       title: string,
 *     },
 *   },
 *   options: {
 *     url: {
 *       tiles: string,
 *     },
 *   },
 *   registeredTiles: Object.<string, string>,
 *   world: {
 *     name: string,
 *   },
 * }}
 */

/**
 * @description 导出 Dynmap 地图图片
 * @param   {object}            options
 * @param   {DynmapInstance}    options.dynmap
 * @param   {boolean}           [options.autoStart]
 * @param   {boolean}           [options.calcOnly]
 * @param   {string}            [options.fillColor]
 * @param   {number|null}       [options.maxTiles]
 * @param   {'corner'|'viewed'} [options.mode]
 * @param   {number}            [options.timeout]
 * @returns {Promise<boolean>}
 */
async function exportDynmap(options = {}) {

  /**
   * @description 将 Base64 转换为 Blob
   * @param {string} dataURL Base64 字符串
   */
  function dataURLtoBlob(dataURL) {

    if (!dataURL) {
      console.error('转换 Blob 失败，缺少 dataURL 参数。');
      return null;
    }

    let arr = dataURL.split(',');

    if (arr.length !== 2) {
      console.error('转换 Blob 失败，Base64 字符串格式不符合要求。');
      return;
    }

    try {

      let mime = arr[0].match(/(:)(.*?)(;)/)[2];
      let bStr = atob(arr[1]);
      let bLength = bStr.length;
      let u8Arr = new Uint8Array(bLength);

      while (bLength--) {
        u8Arr[bLength] = bStr.charCodeAt(bLength);
      }

      return new Blob([u8Arr], { type: mime });

    } catch (error) {
      console.error('转换 Blob 失败：');
      console.error(error);
      return null;
    }

  }

  /**
   * @description 获取图片元素（异步）
   * @param   {string} url 图片地址
   * @returns {Promise<HTMLImageElement|null>}
   */
  function getImage(url) {
    return new Promise((resolve) => {
      // 检测参数
      if (!url) {
        console.error('获取图片失败，缺少 url 参数。');
        return resolve(null);
      }
      // 创建图片元素
      let image = new Image();
      // 监听：加载失败
      image.onerror = function () {
        console.error(`图片加载失败（${url}）`);
        resolve(null);
      };
      // 监听：加载成功
      image.onload = function () {
        resolve(image);
      };
      // 设置 URL，开始加载
      image.setAttribute('src', url);
    });
  }

  /**
   * @description 通过点路径访问对象属性
   * @param {object} obj
   * @param {string} path
   */
  function getObjValue(obj, path = '') {
    if (typeof obj !== 'object') {
      console.error('访问失败，参数 obj 错误。');
      return;
    }
    if (typeof path !== 'string') {
      console.error('访问失败，参数 path 错误。');
      return;
    }
    if (path === '') {
      return obj;
    }
    return path.split('.').reduce((a, b) => {
      return (a === undefined ? a : a[b]);
    }, obj);
  }

  // 输出内容分组 - 开始
  console.group('Dynmap 图片导出');

  try {
    return await (async function () {

      /** 分隔线 */
      let divideLine = '-'.repeat(50);

      console.log(divideLine);
      console.log('处理中，请稍候...');

      let {
        dynmap,
        autoStart = false,
        calcOnly = false,
        fillColor = '#000000',
        maxTiles = null,
        mode = 'viewed',
        timeout = 20,
      } = options;

      // dynmap 对象中应存在的属性
      let attrs = [
        // 当前地图的配置选项
        'maptype.options',
        // 当前地图缩放范围配置
        'maptype.options.mapzoomin',
        'maptype.options.mapzoomout',
        // 当前地图所在文件夹名称
        'maptype.options.prefix',
        // 当前地图每个 tile 的分辨率
        'maptype.options.tileSize',
        // 地图 tiles 路径配置选项
        'options.url.tiles',
        // 加载过的 tiles
        'registeredTiles',
        // 当前世界名称
        'world.name',
      ];

      // 检测 dynmap 对象
      if (typeof dynmap === 'undefined' || !dynmap) {
        console.error('导出失败，dynmap 对象不存在。');
        return false;
      }

      // 检测 dynmap 对象属性
      for (let attr of attrs) {
        let item = getObjValue(dynmap, attr);
        if (typeof item === 'undefined' || item === null) {
          console.error(`导出失败， dynmap 对象缺少 ${attr} 属性`);
          return false;
        }
      }

      /** 地图当前缩放等级（最小为 0，表示最远）*/
      let mapZoomCurr = dynmap.map.getZoom();

      /** 地图向内缩放范围（最小为 0）*/
      let mapZoomIn = dynmap.maptype.options.mapzoomin;

      /** 地图向外缩放范围（最小为 0）*/
      let mapZoomOut = dynmap.maptype.options.mapzoomout;

      /** @type {number[]} */
      let tileLevels = [];

      // 根据缩放范围生成缩放等级与 tile 等级的映射关系
      for (let i = mapZoomIn * -1; i <= mapZoomOut; i++) {
        tileLevels.unshift(i >= 0 ? i : 0);
      }

      /** 地图 tiles 路径（默认为 `tiles/`）*/
      let tilesDir = dynmap.options.url.tiles;

      /** 地图 tiles 列表 */
      let tileList = dynmap.registeredTiles;

      /**
       * @desc 保存使用的 tiles 信息
       * @type {{ filePath: string, tilePos: number[] }[]}
       */
      let tileInfo = [];

      /** 条件：tile 等级 */
      let useLevel = tileLevels[mapZoomCurr];

      /** 条件：世界名称 */
      let useWorld = dynmap.world.name;

      /** 条件：地图名称 */
      let useMap = dynmap.maptype.options.prefix;

      // tile 坐标最值
      let tileMinX = 0, tileMaxX = 0, tileMinY = 0, tileMaxY = 0;

      // 相邻 tile 的坐标差值
      let tilePosOffset = Math.pow(2, useLevel);

      // 每个 tile 的分辨率
      let tileResolution = dynmap.maptype.options.tileSize;

      if (tileResolution === 0) {
        console.error('导出失败，获取到的 tile 分辨率为 0。');
        return false;
      }

      // 提取 & 处理需要使用的信息
      for (let key in tileList) {

        let filePath = tileList[key];
        let fileName = '';
        let mapName = '';
        let worldName = '';

        // 将文件路径拆分为数组
        // ['tiles', 'world', 'flat', '0_0', 'zzz_0_0.png']
        let split = filePath.split('/');
        let length = split.length;

        // 获取：tile 文件名、地图名称、世界名称
        if (length >= 5) {
          fileName = split[length - 1];
          mapName = split[length - 3];
          worldName = split[length - 4];
        } else {
          console.error('导出失败，tile 文件路径格式不符合要求。');
          return false;
        }

        // 提取 tile 等级
        // 文件名中“z”的位数随“缩放等级”的提高而减少，最少为 0
        let tileLevelS = fileName.match(/z+/);
        let tileLevelN = (tileLevelS ? tileLevelS[0].length : 0);

        /** @type {number[]} */
        let tilePos = fileName.match(/-?[0-9]+/g);

        // 提取 tile 坐标字符串
        if (Array.isArray(tilePos) && tilePos.length === 2) {
          tilePos = tilePos.map(v => parseInt(v));
        } else {
          console.error('导出失败，tile 文件名格式不符合要求。');
          return false;
        }

        let isUse = (
          tileLevelN === useLevel &&
          worldName === useWorld &&
          mapName === useMap
        );

        // 排除
        if (!isUse) {
          continue;
        }

        // 移除坐标差值
        tilePos[0] = tilePos[0] / tilePosOffset;
        tilePos[1] = tilePos[1] / tilePosOffset;

        // 提取坐标，用于检测和记录最值
        let [tileX, tileY] = tilePos;

        // 记录 X 最值
        (tileX < tileMinX) && (tileMinX = tileX);
        (tileX > tileMaxX) && (tileMaxX = tileX);
        // 记录 Y 最值
        (tileY < tileMinY) && (tileMinY = tileY);
        (tileY > tileMaxY) && (tileMaxY = tileY);

        tileInfo.push({
          filePath,
          tilePos,
        });

      }

      // 若为角落模式，根据坐标最值重新生成 tile 信息
      if (mode === 'corner') {
        tileInfo = [];
        for (let tileX = tileMinX; tileX <= tileMaxX; tileX++) {
          for (let tileY = tileMinY; tileY <= tileMaxY; tileY++) {

            let fileDir = '';
            let fileName = '';

            // 计算文件名中的坐标
            let fileX = tileX * tilePosOffset;
            let fileY = tileY * tilePosOffset;

            // 根据文件名坐标计算其所属的文件夹名称
            fileDir = `${Math.floor(fileX / 32)}_${Math.floor(fileY / 32)}`;

            // 添加 tile 等级前缀（长度包含 _ 符号）
            if (useLevel > 0) {
              fileName = '_'.padStart(useLevel + 1, 'z');
            }

            // 拼接 tile 文件名
            fileName += `${fileX}_${fileY}`;

            // 计算 tile 所在文件夹
            tileInfo.push({
              filePath: `${tilesDir}${useWorld}/${useMap}/${fileDir}/${fileName}`,
              tilePos: [tileX, tileY],
            });

          }
        }
      }

      // 根据 tiles 坐标范围和 tile 分辨率计算画布宽高
      let cWidth = (tileMaxX - tileMinX) * tileResolution;
      let cHeight = (tileMaxY - tileMinY) * tileResolution;

      console.log(divideLine);
      console.log('导出配置信息：', {
        config: {
          mapZoomCurr, mapZoomIn, mapZoomOut,
          tileLevels, tilesDir,
          useLevel, useWorld, useMap, tileInfo,
          tileMinX, tileMaxX, tileMinY, tileMaxY,
          tilePosOffset, tileResolution,
        },
        options,
      });
      console.log(`地图 tile 总数：${tileInfo.length}`);
      console.log(`导出图片分辨率：${cWidth} x ${cHeight}`);
      console.log(divideLine);

      // 仅计算信息，不导出
      if (calcOnly) {
        return true;
      }

      // 检测是否存在数据，若无则结束
      if (tileInfo.length === 0) {
        console.warn('图片列表为空，取消导出。');
        return false;
      }

      let confirmed = null;

      // 等待确认
      await new Promise((resolve) => {

        // 倒计时文本
        let getMsg = function (s) {
          let msg = [
            `请在 ${s} 秒内执行 confirmExport() 以确认导出，`,
            `或执行 cancelExport() 以取消导出。`,
          ];
          return msg.join('');
        };

        // 无需确认，自动开始
        if (autoStart) {
          confirmed = true;
          return resolve();
        }

        // 提示信息显示间隔秒数
        let interval = 2;
        let timer = setInterval(() => {

          timeout -= interval;

          if (timeout > 0 && confirmed === null) {
            console.log(getMsg(timeout));
          } else {
            clearInterval(timer);
            console.log(divideLine);
            window.cancelExport = null;
            window.confirmExport = null;
            resolve();
          }

        }, interval * 1000);

        setTimeout(() => {
          console.log(divideLine);
          console.log('地图 tiles 信息处理完成');
          console.log(divideLine);
          console.log(getMsg(timeout));
        }, 0);

        window.cancelExport = function () {
          confirmed = false;
          return '取消导出';
        };

        window.confirmExport = function () {
          confirmed = true;
          return '确认导出';
        };

      });

      if (confirmed) {
        console.log('正在绘制图片，请稍候...');
      } else {
        if (confirmed === null) {
          console.warn('导出已自动取消。');
        } else {
          console.warn('导出已被取消。');
        }
        return true;
      }

      // 创建画布，用于绘制图片
      let canvas = document.createElement('canvas');
      let ctx = canvas.getContext('2d');

      // 计算将 tile 起始坐标移动至 (0, 0) 所需的位移
      let fixTileOffsetX = tileMinX * -1;
      let fixTileOffsetY = tileMinY * -1;

      // tiles 的垂直坐标轴方向与 Canvas 相反，需要转换
      let tileY_U = [];
      let tileY_D = [];

      /** @type {Object.<string, number>} */
      let tileY_R = {};

      // 生成正反方向的坐标点
      for (let i = tileMinY; i <= tileMaxY; i++) {
        tileY_U.push(i);
        tileY_D.unshift(i);
      }

      // 生成垂直坐标映射关系
      tileY_U.forEach((v, i) => {
        tileY_R[String(v)] = tileY_D[i];
      });

      // 设置画布宽高
      canvas.width = cWidth;
      canvas.height = cHeight;

      // 设置画布背景颜色
      ctx.fillStyle = fillColor;
      ctx.fillRect(0, 0, cWidth, cHeight);

      // 打开新窗口显示结果
      let newWin = window.open('', 'ExportResult', 'width=800, height=480');

      // 获取图片，绘制到画布
      for (let i = 0; i < tileInfo.length; i++) {

        if (typeof maxTiles === 'number' && i > maxTiles) {
          break;
        }

        let item = tileInfo[i];
        let [tileX, tileY] = item.tilePos;

        // 转换垂直坐标
        tileY = tileY_R[String(tileY)];

        // 计算绘制坐标
        let x = (tileX + fixTileOffsetX) * tileResolution;
        let y = (tileY + fixTileOffsetY) * tileResolution;

        // 获取图片
        let image = await getImage(item.filePath);

        if (image) {
          ctx.drawImage(image, x, y);
        }

      }

      // 将画布内容转换为图片
      let dataURL = canvas.toDataURL('image/png');
      let blob = dataURLtoBlob(dataURL);

      // 移除画布
      canvas.remove();

      if (!blob) {

        console.error('导出失败。');

        // 关闭打开的新窗口
        try {
          newWin && newWin.close();
        } catch (errClose) {
          console.error('关闭新窗口失败：');
          console.error(errClose);
        }

        return false;

      }

      // 生成图片地址
      let resultURL = window.URL.createObjectURL(blob);

      try {

        let errMessage = [
          '无法打开新窗口，',
          '可能是没有权限，',
          '请手动复制图片地址',
          '（需要包含“blob:”部分）。',
        ];

        if (!newWin) {
          throw new Error(errMessage.join(''));
        }

        // 显示导出结果
        newWin.document.write(`<img src="${resultURL}" />`);
        newWin.document.title = 'Dynmap 图片导出结果';
        newWin.focus();

      } catch (errOpen) {
        console.warn('初始化新窗口失败：');
        console.warn(errOpen);
      }

      console.log(`导出完成，图片地址：${resultURL}`);

      return true;

    })();
  } finally {

    // 输出内容分组 - 结束
    console.groupEnd();

  }

}
