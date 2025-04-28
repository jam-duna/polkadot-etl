# Dune Ingestion

```
mysql> select chainID, id, backfillLookback, blocksCovered, blocksArchived from chain where duneIntegration = 1;
+---------+----------+------------------+---------------+----------------+
| chainID | id       | backfillLookback | blocksCovered | blocksArchived |
+---------+----------+------------------+---------------+----------------+
|       0 | polkadot |         19317878 |      19318007 |       17484147 |
|       2 | kusama   |         21709912 |      21710088 |       19869873 |
|    1000 | assethub |          5577562 |       5577778 |        4647073 | 4647109
|    2004 | moonbeam |          5437164 |       5437259 |        4500786 | 4500787
|    2006 | astar    |          5449223 |       5449430 |        4509701 | 4509728
|    2030 | bifrost  |          3990700 |       3990895 |        3129083 | 3129094
|    2032 | interlay |          4534998 |       4535564 |        3605820 | 3605851
|    2034 | hydradx  |          4395310 |       4395329 |        3467904 | 3467948
+---------+----------+------------------+---------------+----------------+
8 rows in set (0.01 sec)

mysql> select chainID, count(logDT) from blocklog where loaded = 0 and chainID in (select chainID from chain where duneIntegration = 1 ) group by chainID;
+---------+--------------+
| chainID | count(logDT) |
+---------+--------------+
|       0 |          261 |
|       2 |           61 |
|    1000 |            2 |
|    2004 |            3 |
|    2006 |            2 |
|    2030 |            3 |
|    2032 |            2 |
|    2034 |            2 |
+---------+--------------+
8 rows in set (0.01 sec)

mysql> select chainID, count(logDT) from blocklog where loaded = 0 and chainID in (select chainID from chain where duneIntegration = 1 ) group by chainID;
+---------+--------------+
| chainID | count(logDT) |
+---------+--------------+
|       0 |         1178 |
|       2 |         1441 |
|    1000 |          819 |
|    2004 |          777 |
|    2006 |          776 |
|    2030 |          609 |
|    2032 |          692 |
|    2034 |          692 |
+---------+--------------+
8 rows in set (0.01 sec)


SELECT
    _TABLE_SUFFIX as p, count(block_number), min(block_time) as ts
FROM
  `bigquery-public-data.crypto_polkadot.calls*`
  where call_section = 'timestamp'
  group by _TABLE_SUFFIX
  having _TABLE_SUFFIX in ("0", "2", "1000", "2004", "2006", "2030" , "2032" , "2034")
ORDER BY
    _TABLE_SUFFIX


    0
    3533750
    2020-05-27 00:00:00 UTC

    1000
    28513
    2024-01-29 00:00:06 UTC

2004 21271 2023-07-11 23:32:36 UTC

2006 - 28428    2024-01-29 00:00:06 UTC
2030 - 21071    2024-01-29 00:00:06 UTC
2032 - 28147    2024-01-29 00:00:07 UTC
2034 - 28477    2024-01-29 00:00:06 UTC
```

mysql> select chainID, logDT, hr from indexlog where chainID in ( select chainID from chain where duneIntegration = 1 )  and indexed = 0 and readyForIndexing = 1;
+---------+------------+----+
| chainID | logDT      | hr |
+---------+------------+----+
|       2 | 2023-01-06 | 12 |
|    2004 | 2023-04-05 | 15 |
|    2004 | 2023-04-05 | 16 |
|    2004 | 2023-04-05 | 17 |
+---------+------------+----+
4 rows in set (0.07 sec)



# polkadot - 0

```
mysql> select floor(blockNumber / 10) as f, min(blockDT), count(*), min(blockNumber), max(blockNumber), sum(crawlblock) crawlBlock, max(blockNumber)-min(blockNumber)+1 - count(*) missing from block0 where
 blockNumber >= 1 and blockDT > "2017-01-01" group by f having count(*) < 10 and min(blockDT) < "2024-02-01" and min(blockNumber) > 1;

./polkaholic indexblock 0 10604027,10604028,10604029,10604136,10604137,10604139,10604246,10604247,10604248,10604249,10604250,10604869,10604870,10604871,10604872,10604873,10604874,10604875,10605630,10605631,10605634,10605699,10605701,10605702,10605703
./polkaholic indexblock 0 10605704,10605705,10605820,10605824,10605887,10605896,10606486,10606487,10606489,10606490,10606491,10744930,10745051,12784547,16365860,16365861,16365862,16365863,16365865,16365866,16365867,16366073,16425417,16425419,16425420,16425421,16425422,16425423,16425424,16728431,16757297,16757498,16757501,16757593,16757594,16757595,16757596,16757600,16757601,16757602,16757918,16757922,16758104,16758108,16758112,16758325,16758465,16758466,16758467,16758470,16758471,16758472,16759114,16845835,17020702,17020728,17020734,17022298,17022337,17022942,17022945
```


# kusama - 2

```
mysql> select floor(blockNumber / 10) as f, min(blockDT), count(*), min(blockNumber), max(blockNumber), sum(crawlblock) crawlBlock, max(blockNumber)-min(blockNumber)+1 - count(*) missing from block2 where blockNumber >= 1 and blockDT > "2017-01-01" group by f having count(*) < 10 and min(blockDT) < "2024-02-01" and min(blockNumber) > 1;

+---------+---------------------+----------+------------------+------------------+------------+---------+
| f       | min(blockDT)        | count(*) | min(blockNumber) | max(blockNumber) | crawlBlock | missing |
+---------+---------------------+----------+------------------+------------------+------------+---------+
| 1750983 | 2023-04-16 17:04:24 |        7 |         17509830 |         17509836 |          0 |       0 |
| 1750984 | 2023-04-16 17:05:24 |        9 |         17509840 |         17509849 |          0 |       1 |
| 1840789 | 2023-06-18 07:42:36 |        9 |         18407890 |         18407899 |          0 |       1 |
| 1840959 | 2023-06-18 10:32:36 |        9 |         18409590 |         18409599 |          0 |       1 |
| 1852112 | 2023-06-26 04:46:06 |        9 |         18521120 |         18521129 |          0 |       1 |
| 1941095 | 2023-08-27 01:45:30 |        9 |         19410950 |         19410959 |          0 |       1 |
| 1941239 | 2023-08-27 04:09:54 |        9 |         19412390 |         19412399 |          0 |       1 |
| 1941270 | 2023-08-27 04:40:54 |        9 |         19412700 |         19412709 |          0 |       1 |
| 1941371 | 2023-08-27 06:22:00 |        9 |         19413710 |         19413719 |          0 |       1 |
| 1941392 | 2023-08-27 06:43:00 |        2 |         19413920 |         19413925 |          0 |       4 |
| 1941410 | 2023-08-27 07:01:00 |        9 |         19414100 |         19414109 |          0 |       1 |
| 1941428 | 2023-08-27 07:19:00 |        7 |         19414280 |         19414287 |          0 |       1 |
| 1941429 | 2023-08-27 07:20:06 |        9 |         19414291 |         19414299 |          0 |       0 |
| 1941506 | 2023-08-27 08:37:06 |        9 |         19415060 |         19415069 |          0 |       1 |
| 2086975 | 2023-12-06 13:47:12 |        9 |         20869750 |         20869759 |          0 |       1 |
| 2111578 | 2023-12-23 16:42:36 |        9 |         21115780 |         21115789 |          0 |       1 |
| 2112519 | 2023-12-24 08:26:24 |        9 |         21125190 |         21125199 |          0 |       1 |
+---------+---------------------+----------+------------------+------------------+------------+---------+
17 rows in set (5 min 36.73 sec)


./polkaholic indexblock 2 21706996,21707333,21707421,21707717,21707774,21707934,21708085,21708089,21708128,21708129,21708130,21708131,17509837,17509838,17509839,17509842,18407895,18409593,18521124,19410956,19412391,19412707,19413716,19413921,19413922,19413923,19413924,19413926,19413927,19413928,19413929,19414105,19414284,19414288,19414289,19414290,19415068,20869752,21115781,21125197,21705087,21705126,21705280,21705287,21705360,21705486,21705849,21705909,21705999,21706008,21706029,21706060,21706153,21706235,21706274,21706297,21706311,21706634,21706737,21706929.

```


# astar - 2006

```
mysql> select Year(blockDT), count(*), min(blockNumber), max(blockNumber), sum(crawlblock) crawlBlock, max(blockNumber)-min(blockNumber)+1 - count(*) missing from block2006 where blockNumber >= 1 and blockDT > "2017-01-01" group by Year(blockDT);
+---------------+----------+------------------+------------------+------------+---------+
| Year(blockDT) | count(*) | min(blockNumber) | max(blockNumber) | crawlBlock | missing |
+---------------+----------+------------------+------------------+------------+---------+
|          2021 |    96274 |                1 |            96274 |          0 |       0 |
|          2022 |  2530825 |            96275 |          2627099 |          0 |       0 |
|          2023 |  2587374 |          2627100 |          5214474 |          0 |       1 |
|          2024 |   233277 |          5214475 |          5447752 |          0 |       1 |
+---------------+----------+------------------+------------------+------------+---------+
```

* FIXED `./polkaholic indexblock 2006 4156165` @ 2023-08-05 14:01:12

# moonbeam - 2004

```
mysql> select Year(blockDT), count(*), min(blockNumber), max(blockNumber), sum(crawlblock) crawlBlock, max(blockNumber)-min(blockNumber)+1 - count(*) missing from block2004 where blockNumber >= 1 and blockDT > "2017-01-01" group by Year(blockDT);
+---------------+----------+------------------+------------------+------------+---------+
| Year(blockDT) | count(*) | min(blockNumber) | max(blockNumber) | crawlBlock | missing |
+---------------+----------+------------------+------------------+------------+---------+
|          2021 |    97534 |                1 |            97534 |          0 |       0 |
|          2022 |  2534418 |            97535 |          2631952 |          0 |       0 |
|          2023 |  2570942 |          2631953 |          5202898 |          0 |       4 |
|          2024 |   232692 |          5202899 |          5435590 |          0 |       0 |
+---------------+----------+------------------+------------------+------------+---------+
4 rows in set (3.54 sec)
```

## FIXED THIS:
```
mysql> select floor(blockNumber / 10) as f, min(blockDT), count(*), min(blockNumber), max(blockNumber), sum(crawlblock) crawlBlock, max(blockNumber)-min(blockNumber)+1 - count(*) missing from block2004 where blockNumber >= 1 and blockDT > "2017-01-01" group by f having count(*) < 10 and min(blockDT) < "2024-02-01" and min(blockNumber) > 1;
Empty set (22.38 sec)
```
* FIXED: ./polkaholic indexblock 2004 3929805,3952064,3952315,4154075

# assethub - 1000


mysql> select Year(blockDT), count(*), min(blockNumber), max(blockNumber), sum(crawlblock) crawlBlock, max(blockNumber)-min(blockNumber)+1 - count(*) missing from block1000 where blockNumber >= 1 and bloc
kDT > "2017-01-01" group by Year(blockDT);
+---------------+----------+------------------+------------------+------------+---------+
| Year(blockDT) | count(*) | min(blockNumber) | max(blockNumber) | crawlBlock | missing |
+---------------+----------+------------------+------------------+------------+---------+
|          2021 |   389635 |                1 |           389635 |          0 |       0 |
|          2022 |  2504325 |           389636 |          2893960 |          0 |       0 |
|          2023 |  2448496 |          2893961 |          5342456 |          0 |       0 |
|          2024 |   233697 |          5342457 |          5576153 |          0 |       0 |
+---------------+----------+------------------+------------------+------------+---------+
4 rows in set (48.42 sec)

* no missing blocks check calls


# bifrost - 2030

mysql> select Year(blockDT), count(*), min(blockNumber), max(blockNumber), sum(crawlblock) crawlBlock, max(blockNumber)-min(blockNumber)+1 - count(*) missing from block2030 where blockNumber >= 1 and bloc
kDT > "2017-01-01" group by Year(blockDT);
+---------------+----------+------------------+------------------+------------+---------+
| Year(blockDT) | count(*) | min(blockNumber) | max(blockNumber) | crawlBlock | missing |
+---------------+----------+------------------+------------------+------------+---------+
|          2022 |  1426950 |                1 |          1426952 |          0 |       2 |
|          2023 |  2331571 |          1426953 |          3758523 |          0 |       0 |
|          2024 |   230797 |          3758524 |          3989320 |          0 |       0 |
+---------------+----------+------------------+------------------+------------+---------+
3 rows in set (39.24 sec)

### FIXED

mysql> select floor(blockNumber / 10) as f, min(blockDT), count(*), min(blockNumber), max(blockNumber), sum(crawlblock) crawlBlock, max(blockNumber)-min(blockNumber)+1 - count(*) missing from block2030 where blockNumber >= 1 and blockDT > "2017-01-01" group by f having count(*) < 10 and min(blockDT) < "2024-02-01" and min(blockNumber) > 1;
Empty set (12.22 sec)

* FIXED ./polkaholic indexblock 2030 227120,244340


# hydradx - 2034

mysql> select Year(blockDT), count(*), min(blockNumber), max(blockNumber), sum(crawlblock) crawlBlock, max(blockNumber)-min(blockNumber)+1 - count(*) missing from block2034 where blockNumber >= 1 and blockDT > "2017-01-01" group by Year(blockDT);
+---------------+----------+------------------+------------------+------------+---------+
| Year(blockDT) | count(*) | min(blockNumber) | max(blockNumber) | crawlBlock | missing |
+---------------+----------+------------------+------------------+------------+---------+
|          2022 |  1672352 |                1 |          1672352 |       1771 |       0 |
|          2023 |  2489597 |          1672353 |          4161952 |          0 |       3 |
|          2024 |   231797 |          4161953 |          4393749 |          0 |       0 |
+---------------+----------+------------------+------------------+------------+---------+
3 rows in set (43.62 sec)

### FIXES

```
mysql> select floor(blockNumber / 10) as f, min(blockDT), count(*), min(blockNumber), max(blockNumber), sum(crawlblock) crawlBlock, max(blockNumber)-min(blockNumber)+1 - count(*) missing from block2034 where blockNumber >= 1 and blockDT > "2017-01-01" group by f having count(*) < 10 and min(blockDT) < "2024-02-01" and min(blockNumber) > 1;
Empty set (14.21 sec)
```

* FIXED ./polkaholic indexblock 2034 2920218,3171134,3171290

# interlay - 2032

mysql> select Year(blockDT), count(*), min(blockNumber), max(blockNumber), sum(crawlblock) crawlBlock, max(blockNumber)-min(blockNumber)+1 - count(*) missing from block2032 where blockNumber >= 1 and blockDT > "2017-01-01" group by Year(blockDT);
+---------------+----------+------------------+------------------+------------+---------+
| Year(blockDT) | count(*) | min(blockNumber) | max(blockNumber) | crawlBlock | missing |
+---------------+----------+------------------+------------------+------------+---------+
|          2022 |  1876869 |                1 |          1876891 |          0 |      22 |
|          2023 |  2424369 |          1876892 |          4301264 |          0 |       4 |
|          2024 |   232889 |          4301265 |          4534153 |          0 |       0 |
+---------------+----------+------------------+------------------+------------+---------+
3 rows in set (44.06 sec)


### FIXES

```
mysql> select floor(blockNumber / 10) as f, min(blockDT), count(*), min(blockNumber), max(blockNumber), sum(crawlblock) crawlBlock, max(blockNumber)-min(blockNumber)+1 - count(*) missing from block2032 where blockNumber >= 1 and blockDT > "2017-01-01" group by f having count(*) < 10 and min(blockDT) < "2024-02-01" and min(blockNumber) > 1;
Empty set (15.14 sec)
```

* FIXED ./polkaholic indexblock 2032 495544,496139,496141,496142,496164,496165,496166,496171,496172,496255,496256,496259,496260,496261,496262,496965,496966,496967,496968,496971,496972,1044781,3241434,3241440,3241441,3241443
