import { Global, Module } from '@nestjs/common';
import { AppCache } from './cache/app-cache.service';

@Global()
@Module({
  providers: [AppCache],
  exports: [AppCache],
})
export class CommonModule {}
